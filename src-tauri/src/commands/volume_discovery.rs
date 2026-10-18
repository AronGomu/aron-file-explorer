use crate::models::VolumeInformation;
use serde_json::Value;
use std::collections::HashSet;
use std::process::Command;

pub(super) fn discover(mounted: &[VolumeInformation]) -> Option<Vec<VolumeInformation>> {
    let output = Command::new("lsblk").args([
        "--json", "--bytes", "--paths", "--output",
        "NAME,TYPE,SIZE,FSTYPE,LABEL,MOUNTPOINTS,RM,FSAVAIL,PARTTYPE",
    ]).output().ok()?;
    if !output.status.success() { return None; }
    let tree: Value = serde_json::from_slice(&output.stdout).ok()?;
    tree["blockdevices"].as_array()?;
    Some(physical_volumes(&tree, mounted))
}

fn physical_volumes(tree: &Value, mounted: &[VolumeInformation]) -> Vec<VolumeInformation> {
    fn walk(node: &Value, physical_size: Option<u64>, removable: bool,
        mounted: &[VolumeInformation], seen: &mut HashSet<String>, result: &mut Vec<VolumeInformation>) {
        let device = node["name"].as_str().unwrap_or("");
        let kind = node["type"].as_str().unwrap_or("");
        if !device.starts_with("/dev/") || device.starts_with("/dev/zram") { return; }
        let physical_size = if kind == "disk" { node["size"].as_u64() } else { physical_size };
        if physical_size.is_none() && kind != "disk" { return; }
        let removable = removable || node["rm"].as_bool().unwrap_or(false);
        let fs = node["fstype"].as_str().unwrap_or("");
        let paths: Vec<_> = node["mountpoints"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        let root = paths.contains(&"/");
        let mount = if root { "/" } else { paths.first().copied().unwrap_or("") };
        let boot_type = matches!(node["parttype"].as_str().unwrap_or("").to_ascii_lowercase().as_str(),
            "c12a7328-f81f-11d2-ba4b-00a0c93ec93b" | "21686148-6449-6e6f-744e-656564454649" | "e3c9e316-0b5c-4db8-817d-f92df00215ae");
        let system_mount = ["/boot", "/efi", "/proc", "/sys", "/dev"].iter().any(|path|
            mount == *path || mount.starts_with(&format!("{path}/"))) ||
            (mount.starts_with("/run/") && !mount.starts_with("/run/media/")) ||
            mount == "/tmp" || mount.starts_with("/tmp/");
        if !fs.is_empty() && !matches!(fs, "swap" | "crypto_LUKS" | "LVM2_member" | "linux_raid_member") &&
            !boot_type && !system_mount && seen.insert(device.to_string()) {
            let stats = mounted.iter().find(|v| v.mount_point == mount && !mount.is_empty());
            result.push(VolumeInformation {
                volume_name: if root { "System (/)".into() } else {
                    node["label"].as_str().filter(|s| !s.is_empty()).map(str::to_string)
                        .unwrap_or_else(|| format!("Disk ({})", device.rsplit('/').next().unwrap_or(device)))
                },
                mount_point: mount.into(), file_system: fs.into(),
                size: stats.map(|v| v.size).unwrap_or_else(|| node["size"].as_u64().unwrap_or(0)),
                available_space: stats.map(|v| v.available_space).unwrap_or_else(|| node["fsavail"].as_u64().unwrap_or(0)),
                is_removable: removable, total_written_bytes: stats.map(|v| v.total_written_bytes).unwrap_or(0),
                total_read_bytes: stats.map(|v| v.total_read_bytes).unwrap_or(0),
                device: Some(device.into()), is_mounted: !mount.is_empty(), drive_size: physical_size,
            });
        }
        for child in node["children"].as_array().into_iter().flatten() {
            walk(child, physical_size, removable, mounted, seen, result);
        }
    }
    let mut result = Vec::new(); let mut seen = HashSet::new();
    for disk in tree["blockdevices"].as_array().into_iter().flatten() {
        if disk["type"] == "disk" { walk(disk, None, false, mounted, &mut seen, &mut result); }
    }
    result.sort_by_key(|volume| (volume.mount_point != "/", volume.device.clone()));
    result
}

pub(super) fn mount(device: &str) -> Result<String, String> {
    let volumes = super::get_system_volumes_information();
    let volume = volumes.iter().find(|v| v.device.as_deref() == Some(device))
        .ok_or("Drive is no longer available")?;
    if volume.is_mounted { return Ok(volume.mount_point.clone()); }
    let output = Command::new("udisksctl").args(["mount", "--block-device", device])
        .output().map_err(|_| "Could not start udisksctl; install UDisks2 to mount drives")?;
    if !output.status.success() { return Err("Could not mount drive. Check filesystem health and desktop mount permissions.".into()); }
    super::get_system_volumes_information().into_iter()
        .find(|v| v.device.as_deref() == Some(device) && v.is_mounted)
        .map(|v| v.mount_point).ok_or_else(|| "Drive mounted but its location is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn useful_drives_include_unmounted_data_disk_and_exclude_system_volumes() {
        let tree = json!({"blockdevices":[
            {"name":"/dev/nvme0n1","type":"disk","size":1000000000000_u64,"rm":false,"children":[
                {"name":"/dev/nvme0n1p1","type":"part","fstype":"vfat","size":2000000000_u64,"mountpoints":["/boot"]},
                {"name":"/dev/nvme0n1p2","type":"part","fstype":"crypto_LUKS","children":[
                    {"name":"/dev/mapper/root","type":"crypt","fstype":"btrfs","size":998000000000_u64,"mountpoints":["/home","/var/log","/"]}]}]},
            {"name":"/dev/sda","type":"disk","size":4000000000000_u64,"rm":false,"children":[
                {"name":"/dev/sda1","type":"part","fstype":"ntfs","size":3000000000000_u64,"mountpoints":[null]}]},
            {"name":"/dev/sdb","type":"disk","size":16000000000_u64,"rm":true,"children":[
                {"name":"/dev/sdb1","type":"part","fstype":"vfat","label":"USB","size":15900000000_u64,"mountpoints":["/run/media/user/USB"]}]},
            {"name":"/dev/zram0","type":"disk","fstype":"swap","size":32000000000_u64,"mountpoints":["[SWAP]"]},
            {"name":"/dev/loop0","type":"loop","fstype":"squashfs","mountpoints":["/tmp/.mount_app"]}
        ]});
        let volumes = physical_volumes(&tree, &[]);
        assert_eq!(volumes.len(), 3);
        assert_eq!(volumes[0].mount_point, "/");
        let data = volumes.iter().find(|v| v.device.as_deref() == Some("/dev/sda1")).unwrap();
        assert!(!data.is_mounted);
        assert_eq!(data.drive_size, Some(4000000000000));
        assert!(volumes.iter().any(|v| v.is_removable && v.mount_point.ends_with("/USB")));
    }

    #[test]
    fn volume_mount_rejects_unknown_device_without_side_effects() {
        assert_eq!(mount("/tmp/not-a-device; touch /tmp/should-not-exist").unwrap_err(), "Drive is no longer available");
    }

    #[test]
    fn same_label_disks_are_distinct_and_boot_detection_is_not_a_substring() {
        let tree = json!({"blockdevices":[
            {"name":"/dev/sda","type":"disk","fstype":"ext4","label":"Data","mountpoints":["/media/bootcamp"]},
            {"name":"/dev/sdb","type":"disk","fstype":"ext4","label":"Data","mountpoints":["/media/other"]},
            {"name":"/dev/sdc","type":"disk","children":[
                {"name":"/dev/sdc1","type":"part","fstype":"vfat","parttype":"c12a7328-f81f-11d2-ba4b-00a0c93ec93b","mountpoints":[null]}]}
        ]});
        let volumes = physical_volumes(&tree, &[]);
        assert_eq!(volumes.len(), 2);
    }
}
