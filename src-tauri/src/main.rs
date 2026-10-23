// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
pub mod constants;
mod error_handling;
mod filesystem;
pub mod models;
mod search_engine;
mod state;
mod themes;
#[cfg(target_os = "linux")]
mod chooser;
mod launch_requests;

use crate::commands::{
    command_exec_commands, file_system_operation_commands, hash_commands, meta_data_commands,
    search_engine_commands, settings_commands, volume_operations_commands, sftp_file_system_operation_commands, permission_commands, theme_commands
};
use tauri::ipc::Invoke;
use tauri::Manager;

#[tauri::command]
fn get_launch_directories() -> Vec<String> {
    std::env::args_os().skip(1).filter_map(|argument| {
        let path = if argument.to_string_lossy().starts_with("file:") {
            tauri::Url::parse(&argument.to_string_lossy()).ok()?.to_file_path().ok()?
        } else {
            std::path::PathBuf::from(argument)
        };
        let path = path.canonicalize().ok()?;
        path.is_dir().then(|| path.to_string_lossy().into_owned())
    }).collect()
}

fn all_commands() -> fn(Invoke) -> bool {
    #[cfg(target_os = "linux")]
    if chooser::active() {
        return tauri::generate_handler![
            chooser::get_chooser_request, chooser::chooser_list, chooser::chooser_check,
            chooser::chooser_finish, chooser::chooser_new_folder,
            commands::deletion_commands::trash_items,
            commands::deletion_commands::undo_last_deletion,
            commands::deletion_commands::permanently_delete,
            commands::file_move_commands::move_items,
            file_system_operation_commands::copy_file_or_dir,
            file_system_operation_commands::rename,
            file_system_operation_commands::create_file,
            file_system_operation_commands::create_directory,
            commands::image_commands::get_image_thumbnail,
            commands::video_commands::get_video_thumbnail,
            commands::video_commands::get_video_preview,
            commands::video_commands::get_video_preview_segment,
            commands::media_preview_commands::get_video_preview_info,
            commands::media_preview_commands::get_media_preview_url,
            commands::file_preview_commands::get_text_preview,
            commands::file_preview_commands::save_text_preview,
            commands::media_preview_commands::get_media_duration,
            file_system_operation_commands::open_directory,
            commands::open_with_commands::get_open_with_applications,
            commands::open_with_commands::open_file_with_application,
            commands::path_completion_commands::complete_path,
            volume_operations_commands::get_system_volumes_information,
            volume_operations_commands::mount_volume,
            settings_commands::get_settings_snapshot, settings_commands::get_settings_as_json,
            settings_commands::update_settings_field,
            theme_commands::get_theme_catalog, theme_commands::set_active_theme_id,
        ];
    }
    tauri::generate_handler![
        get_launch_directories,
        commands::path_completion_commands::complete_path,
        launch_requests::get_launch_request,
        commands::deletion_commands::trash_items,
        commands::deletion_commands::undo_last_deletion,
        commands::deletion_commands::permanently_delete,
        // Filesystem commands
        //file_system_operation_commands::open_file,
        file_system_operation_commands::open_directory,
        file_system_operation_commands::open_in_default_app,
        commands::open_with_commands::get_open_with_applications,
        commands::open_with_commands::open_file_with_application,
        file_system_operation_commands::create_file,
        file_system_operation_commands::create_directory,
        file_system_operation_commands::rename,
        file_system_operation_commands::move_to_trash,
        file_system_operation_commands::copy_file_or_dir,
        file_system_operation_commands::zip,
        file_system_operation_commands::unzip,
        commands::image_commands::get_image_thumbnail,
        commands::video_commands::get_video_thumbnail,
        commands::video_commands::get_video_preview,
        commands::video_commands::get_video_preview_segment,
        commands::media_preview_commands::get_video_preview_info,
        commands::media_preview_commands::get_media_preview_url,
        commands::media_preview_commands::get_media_duration,
        commands::file_move_commands::move_items,
        sftp_file_system_operation_commands::move_items_sftp,
        commands::file_preview_commands::get_text_preview,
        commands::file_preview_commands::save_text_preview,
        // Command execution commands
        command_exec_commands::execute_command,
        command_exec_commands::execute_command_improved,
        command_exec_commands::execute_command_with_timeout,
        // Metadata commands
        meta_data_commands::get_meta_data_as_json,
        meta_data_commands::update_meta_data,
        // Volume commands
        volume_operations_commands::get_system_volumes_information_as_json,
        volume_operations_commands::get_system_volumes_information,
        volume_operations_commands::mount_volume,
        // Settings commands
        settings_commands::get_settings_as_json,
        settings_commands::get_settings_snapshot,
        theme_commands::get_theme_catalog,
        theme_commands::set_active_theme_id,
        settings_commands::update_settings_field,
        settings_commands::get_setting_field,
        settings_commands::update_multiple_settings_command,
        settings_commands::reset_settings_command,
        // Hash commands
        hash_commands::gen_hash_and_return_string,
        hash_commands::gen_hash_and_save_to_file,
        hash_commands::compare_file_or_dir_with_hash,
        // Autocomplete commands
        search_engine_commands::search,
        search_engine_commands::search_with_extension,
        search_engine_commands::add_paths_recursive,
        search_engine_commands::add_path,
        search_engine_commands::remove_path,
        search_engine_commands::remove_paths_recursive,
        search_engine_commands::clear_search_engine,
        search_engine_commands::get_search_engine_info,
        search_engine_commands::add_paths_recursive_async,
        search_engine_commands::get_indexing_progress,
        search_engine_commands::get_indexing_status,
        search_engine_commands::stop_indexing,
        search_engine_commands::get_suggestions,

        //sftp commands
        sftp_file_system_operation_commands::load_dir,
        sftp_file_system_operation_commands::open_file_sftp,
        sftp_file_system_operation_commands::get_text_preview_sftp,
        sftp_file_system_operation_commands::create_file_sftp,
        sftp_file_system_operation_commands::delete_file_sftp,
        sftp_file_system_operation_commands::rename_file_sftp,
        sftp_file_system_operation_commands::copy_file_sftp,
        sftp_file_system_operation_commands::move_file_sftp,
        sftp_file_system_operation_commands::create_directory_sftp,
        sftp_file_system_operation_commands::delete_directory_sftp,
        sftp_file_system_operation_commands::rename_directory_sftp,
        sftp_file_system_operation_commands::copy_directory_sftp,
        sftp_file_system_operation_commands::move_directory_sftp,
        sftp_file_system_operation_commands::download_and_open_sftp_file,
        sftp_file_system_operation_commands::cleanup_sftp_temp_files,

        // Permission commands
        permission_commands::request_full_disk_access,
        permission_commands::check_directory_access,
    ]
}

struct ThemeHandleOwner(std::sync::Mutex<Option<std::sync::Arc<tauri::AppHandle>>>);
impl Drop for ThemeHandleOwner {
    fn drop(&mut self) {
        // Also enforce join-before-last-handle on setup/runtime unwinding, not just normal Exit.
        if let Some(handle) = self.0.get_mut().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            handle.state::<themes::catalog::ThemeState>().stop_watcher();
        }
    }
}

#[tokio::main]
async fn main() {
    #[cfg(target_os = "linux")]
    if let Err(error) = chooser::initialize() {
        eprintln!("Chooser: {error}");
        std::process::exit(2);
    }
    // External strong owner outlives watcher shutdown; managed state holds only a weak emitter.
    let theme_handle = std::sync::Arc::new(ThemeHandleOwner(std::sync::Mutex::new(None)));
    let setup_theme_handle = theme_handle.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(all_commands())
        .setup(move |app| {
            #[cfg(target_os = "linux")]
            if app.config().identifier == "com.explr.chooser" && !chooser::active() {
                return Err("Launch Explr Chooser through its portal service or --chooser-request".into());
            }
            state::setup_app_state(app)?;
            app.manage(themes::catalog::ThemeState::new(app));
            if commands::theme_commands::restore_active_theme_id(
                &app.state::<themes::catalog::ThemeState>(),
                app.state::<std::sync::Arc<std::sync::Mutex<state::SettingsState>>>().inner(),
            ).is_err() {
                eprintln!("Could not persist the default theme selection");
            }
            let handle = std::sync::Arc::new(app.handle().clone());
            let state = app.state::<themes::catalog::ThemeState>();
            let directory = state.registry.lock().expect("theme registry initialized").catalog.directory.clone();
            *setup_theme_handle.0.lock().expect("theme handle initialized") = Some(handle.clone());
            match themes::watcher::start_theme_watcher(std::sync::Arc::downgrade(&handle), directory.into()) {
                Ok(watcher) => *state.watcher.lock().expect("theme watcher initialized") = Some(watcher),
                Err(_) => {
                    eprintln!("Theme hot reload is unavailable");
                    state.registry.lock().expect("theme registry initialized").watch_issue("Could not start theme watcher");
                }
            }
            #[cfg(target_os = "linux")]
            if chooser::active() {
                chooser::configure_window(app)?;
                return Ok(());
            }
            // Safely show/focus the main window if it exists
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            
            // Clean up old SFTP temporary files on startup
            tokio::spawn(async {
                if let Err(e) = commands::sftp_file_system_operation_commands::cleanup_sftp_temp_files() {
                    eprintln!("Failed to cleanup SFTP temp files: {}", e);
                }
            });
            
            Ok(())
        });

    log_info!("Starting Tauri application...");

    let app = app.build(tauri::generate_context!()).expect({
        let error_msg = "error while running tauri application";
        log_critical!(error_msg);
        &error_msg.to_string()
    });
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<themes::catalog::ThemeState>().stop_watcher();
        }
    });
    drop(theme_handle);
}
