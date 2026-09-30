//! Every process the cockpit starts (agent CLIs, speech server) joins one Windows job object
//! with KILL_ON_JOB_CLOSE: when the cockpit ends — normally, by a crash or from Task Manager —
//! Windows ends them too. No orphaned `claude` / `codex` processes keep running unseen.

#[cfg(windows)]
mod imp {
    use once_cell::sync::Lazy;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    static JOB: Lazy<usize> = Lazy::new(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        job as usize // never closed on purpose: it must live as long as the cockpit
    });

    pub fn bind_handle(handle: *mut core::ffi::c_void) -> bool {
        *JOB != 0 && unsafe { AssignProcessToJobObject(*JOB as _, handle as _) != 0 }
    }

    pub fn bind_pid(pid: u32) -> bool {
        unsafe {
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if h.is_null() {
                return false;
            }
            let ok = bind_handle(h as _);
            CloseHandle(h);
            ok
        }
    }
}

#[cfg(windows)]
pub use imp::{bind_handle, bind_pid};

#[cfg(not(windows))]
pub fn bind_pid(_pid: u32) -> bool {
    false
}

/// Bind a std child process (speech server).
pub fn bind_child(child: &std::process::Child) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        bind_handle(child.as_raw_handle() as _)
    }
    #[cfg(not(windows))]
    {
        let _ = child;
        false
    }
}
