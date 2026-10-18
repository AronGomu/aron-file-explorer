use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInformation {
    pub volume_name: String,
    pub mount_point: String,
    pub file_system: String,
    pub size: u64,
    pub available_space: u64,
    pub is_removable: bool,
    pub total_written_bytes: u64,
    pub total_read_bytes: u64,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default = "mounted_by_default")]
    pub is_mounted: bool,
    #[serde(default)]
    pub drive_size: Option<u64>,
}

fn mounted_by_default() -> bool { true }
