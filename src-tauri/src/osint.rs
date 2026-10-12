//! Open-source intelligence for the board — about infrastructure, from public sources only:
//! a domain's DNS records (DNS over HTTPS), its registration (RDAP), the names in its TLS
//! certificates (certificate transparency, crt.sh), its history in the Wayback Machine, and for
//! an IP address its network owner (RDAP) and rough location. Nothing about private persons.

use std::io::Read;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RobsAICockpit/0.4 (osint)";

#[derive(Serialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub kind: String,
    pub value: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Osint {
    /// "domain" | "ip"
    pub kind: String,
    pub target: String,
    pub dns: Vec<DnsRecord>,
    pub registrar: Option<String>,
    pub registered: Option<String>,
    pub expires: Option<String>,
    pub nameservers: Vec<String>,
    /// names from certificate transparency (subdomains), at most 60
    pub subdomains: Vec<String>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub snapshots: Option<u64>,
    /// ip: who runs the network, and where it is (roughly)
    pub network: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// the IP behind the domain (first A record)
    pub ip: Option<String>,
    /// what could not be looked up
    pub errors: Vec<String>,
}

fn agent(secs: u64) -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(secs))).http_status_as_error(false).max_redirects(5).build().new_agent()
}

fn json(url: &str, secs: u64) -> Result<Value, String> {
    let resp = agent(secs).get(url).header("User-Agent", UA).header("Accept", "application/dns-json, application/json").call().map_err(|e| format!("{url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status()));
    }
    let mut body = Vec::new();
    resp.into_body().into_with_config().limit(4 * 1024 * 1024).reader().take(4 * 1024 * 1024).read_to_end(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| format!("{url}: {e}"))
}

/// "https://www.Example.com/x" → "example.com"-like host; an IPv4 stays as it is.
pub fn normalize(target: &str) -> Option<(String, bool)> {
    let t = target.trim().trim_start_matches("https://").trim_start_matches("http://");
    let host = t.split(['/', '?', '#', ':']).next().unwrap_or("").trim_end_matches('.').to_lowercase();
    if host.is_empty() {
        return None;
    }
    let is_ip = host.split('.').count() == 4 && host.split('.').all(|p| p.parse::<u8>().is_ok());
    if is_ip {
        let private = host.starts_with("10.") || host.starts_with("127.") || host.starts_with("192.168.") || host.starts_with("169.254.") || host.starts_with("0.")
            || (host.starts_with("172.") && host.split('.').nth(1).and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (16..=31).contains(&n)));
        return if private { None } else { Some((host, true)) };
    }
    let ok = host.contains('.') && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') && !host.ends_with(".local") && host != "localhost";
    ok.then_some((host, false))
}

fn rdap_event(v: &Value, action: &str) -> Option<String> {
    v["events"].as_array()?.iter().find(|e| e["eventAction"].as_str() == Some(action)).and_then(|e| e["eventDate"].as_str()).map(|s| s.chars().take(10).collect())
}

fn rdap_registrar(v: &Value) -> Option<String> {
    v["entities"].as_array()?.iter().find(|e| e["roles"].as_array().is_some_and(|r| r.iter().any(|x| x == "registrar"))).and_then(|e| {
        e["vcardArray"][1].as_array()?.iter().find(|f| f[0] == "fn").and_then(|f| f[3].as_str()).map(String::from)
    })
}

/// Look a domain or a public IP address up in public sources (each part may fail on its own).
pub fn lookup(target: &str) -> Result<Osint, String> {
    let (host, is_ip) = normalize(target).ok_or("Give a public domain (example.com) or a public IP address")?;
    let mut o = Osint { kind: if is_ip { "ip".into() } else { "domain".into() }, target: host.clone(), ..Default::default() };
    if !is_ip {
        let base = host.rsplitn(3, '.').take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(".");
        // the slow sources run side by side
        let (dns, rdap, certs, first, last) = std::thread::scope(|sc| {
            let dns = sc.spawn(|| {
                let mut out = Vec::new();
                let mut errs = Vec::new();
                for kind in ["A", "AAAA", "MX", "NS", "TXT"] {
                    match json(&format!("https://dns.google/resolve?name={host}&type={kind}"), 10) {
                        Ok(v) => {
                            for a in v["Answer"].as_array().into_iter().flatten().take(12) {
                                let val = a["data"].as_str().unwrap_or("").trim_matches('"').trim_end_matches('.').to_string();
                                if !val.is_empty() && a["type"].as_u64() != Some(5) {
                                    out.push(DnsRecord { kind: kind.into(), value: val.chars().take(200).collect() });
                                }
                            }
                        }
                        Err(e) => errs.push(format!("DNS {kind}: {e}")),
                    }
                }
                (out, errs)
            });
            let rdap = sc.spawn(|| json(&format!("https://rdap.org/domain/{base}"), 15));
            let certs = sc.spawn(|| json(&format!("https://crt.sh/?q=%25.{base}&output=json&exclude=expired"), 40));
            // the archive limits parallel calls: one after the other
            let archive = sc.spawn(|| {
                let first = json(&format!("https://archive.org/wayback/available?url={base}&timestamp=19900101"), 20);
                std::thread::sleep(std::time::Duration::from_millis(600));
                (first, json(&format!("https://archive.org/wayback/available?url={base}"), 20))
            });
            { let (first, last) = archive.join().unwrap(); (dns.join().unwrap(), rdap.join().unwrap(), certs.join().unwrap(), first, last) }
        });
        o.dns = dns.0;
        o.errors.extend(dns.1);
        o.ip = o.dns.iter().find(|r| r.kind == "A").map(|r| r.value.clone());
        match rdap {
            Ok(v) => {
                o.registrar = rdap_registrar(&v);
                o.registered = rdap_event(&v, "registration");
                o.expires = rdap_event(&v, "expiration");
                o.nameservers = v["nameservers"].as_array().into_iter().flatten().filter_map(|n| n["ldhName"].as_str()).map(|s| s.to_lowercase()).take(8).collect();
            }
            Err(e) => o.errors.push(format!("RDAP: {e}")),
        }
        match certs {
            Ok(v) => {
                let mut names: Vec<String> = v.as_array().into_iter().flatten().filter_map(|c| c["name_value"].as_str()).flat_map(|s| s.split('\n').map(|x| x.trim().trim_start_matches("*.").to_lowercase()).collect::<Vec<_>>()).filter(|n| n.ends_with(&base)).collect();
                names.sort();
                names.dedup();
                o.subdomains = names.into_iter().take(60).collect();
            }
            Err(e) => o.errors.push(format!("Certificates: {e}")),
        }
        let day = |v: &Value| v["archived_snapshots"]["closest"]["timestamp"].as_str().filter(|s| s.len() >= 8).map(|s| format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]));
        match (first, last) {
            (Ok(f), Ok(l)) => { o.first_seen = day(&f); o.last_seen = day(&l); }
            (Err(e), _) | (_, Err(e)) => o.errors.push(format!("Wayback: {e}")),
        }
    }
    let ip = if is_ip { Some(host.clone()) } else { o.ip.clone() };
    if let Some(ip) = ip {
        match json(&format!("https://rdap.org/ip/{ip}"), 15) {
            Ok(v) => o.network = v["name"].as_str().map(String::from).or_else(|| rdap_registrar(&v)),
            Err(e) => o.errors.push(format!("RDAP ip: {e}")),
        }
        match json(&format!("https://ipwho.is/{ip}"), 10) {
            Ok(v) if v["success"].as_bool() != Some(false) => {
                o.country = v["country"].as_str().map(String::from);
                o.city = v["city"].as_str().map(String::from);
                o.lat = v["latitude"].as_f64();
                o.lon = v["longitude"].as_f64();
                if o.network.is_none() {
                    o.network = v["connection"]["org"].as_str().map(String::from);
                }
            }
            Ok(_) => o.errors.push("Location: not found".into()),
            Err(e) => o.errors.push(format!("Location: {e}")),
        }
    }
    Ok(o)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_targets() {
        assert_eq!(normalize("https://WWW.Example.com/path?q=1"), Some(("www.example.com".into(), false)));
        assert_eq!(normalize("8.8.8.8"), Some(("8.8.8.8".into(), true)));
        assert_eq!(normalize("192.168.1.10"), None);
        assert_eq!(normalize("localhost"), None);
        assert_eq!(normalize("printer.local"), None);
        assert_eq!(normalize("not a domain"), None);
    }

    #[test]
    #[ignore = "network"]
    fn looks_up_a_domain() {
        let o = lookup("example.com").unwrap();
        println!("{o:#?}");
        assert!(o.dns.iter().any(|r| r.kind == "A"), "{o:?}");
        assert!(o.registrar.is_some() && o.country.is_some(), "{o:?}");
    }
}
