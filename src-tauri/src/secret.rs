//! API keys the user types in (cloud voices): kept in `<root>/secrets/<name>.bin`, encrypted with
//! Windows DPAPI for the current user — another account or another PC cannot read the file.
//! Keys never go to the frontend, the settings export, the audit log or any log line.

use std::path::PathBuf;

use crate::paths;

fn file(name: &str) -> PathBuf {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    paths::root().join("secrets").join(format!("{safe}.bin"))
}

pub fn save(name: &str, value: &str) -> Result<(), String> {
    let path = file(name);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, protect(value.as_bytes())?).map_err(|e| e.to_string())
}

pub fn load(name: &str) -> Option<String> {
    let raw = std::fs::read(file(name)).ok()?;
    String::from_utf8(unprotect(&raw).ok()?).ok().filter(|s| !s.is_empty())
}

pub fn exists(name: &str) -> bool {
    file(name).is_file()
}

pub fn clear(name: &str) {
    let _ = std::fs::remove_file(file(name));
}

#[cfg(windows)]
fn dpapi(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: the input blob points at `data` for the duration of the call; the output buffer is
    // allocated by Windows, copied, then released with LocalFree.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 || out.pbData.is_null() {
        return Err("Windows could not protect the key".into());
    }
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
    unsafe { LocalFree(out.pbData as _) };
    Ok(bytes)
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, true)
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, false)
}

// Elsewhere the file is only readable by its owner (no DPAPI there).
#[cfg(not(windows))]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}
#[cfg(not(windows))]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip_hides_the_key() {
        let enc = super::protect(b"abc123-secret").unwrap();
        assert!(!enc.windows(6).any(|w| w == b"abc123"), "stored encrypted");
        assert_eq!(super::unprotect(&enc).unwrap(), b"abc123-secret");
    }
}
