import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("chooser_portal", Path(__file__).resolve().parents[1] / "linux/chooser-portal.py")
portal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portal)


class ContractTests(unittest.TestCase):
    def test_open_options_and_utf8_path(self):
        request = portal.normalize("OpenFile", "test.app", "", "Pick", {"current_folder": list('/tmp/été\0'.encode()), "multiple": True, "filters": [('Video', [(1, 'video/*')])]})
        self.assertEqual(request['currentFolder'], '/tmp/été')
        self.assertTrue(request['multiple'])
        self.assertEqual(request['filters'][0][1][0], (1, 'video/*'))

    def test_current_file_sets_save_folder_and_name(self):
        request = portal.normalize("SaveFile", "", "", "Save", {"current_file": list(b'/tmp/report.txt\0'), "current_name": "other"})
        self.assertEqual((request['currentFolder'], request['currentName']), ('/tmp', 'report.txt'))

    def test_invalid_paths_and_names_rejected(self):
        for options in ({"current_folder": list(b'/tmp')}, {"current_folder": list(b'/tmp\0other\0')}, {"current_folder": [255, 0]}):
            with self.assertRaises((ValueError, UnicodeError)):
                portal.normalize("OpenFile", "", "", "", options)
        for files in ([], [list(b'../bad\0')], [list(b'\0')]):
            with self.assertRaises(ValueError):
                portal.normalize("SaveFiles", "", "", "", {"files": files})

    def test_filters_choices_and_boolean_validation(self):
        for options in ({"multiple": "false"}, {"filters": [('bad', [(2, '*')])]}, {"choices": [('x', 'X', [], 'maybe')]}):
            with self.assertRaises(ValueError):
                portal.normalize("OpenFile", "", "", "", options)

    def test_result_preserves_filter_and_choices(self):
        result = portal.response_variant({'response': 0, 'uris': ['file:///tmp/a%20b.txt'], 'choices': [('x', 'true')], 'current_filter': ('Text', [(0, '*.txt')])}).unpack()
        self.assertEqual(result[0], 0)
        self.assertEqual(result[1]['choices'], [('x', 'true')])
        self.assertEqual(result[1]['current_filter'], ('Text', [(0, '*.txt')]))

    def test_result_rejects_remote_and_empty_selections(self):
        for uris in ([], ['sftp://host/file'], ['file://host/tmp/file'], ['file:relative']):
            with self.assertRaises(ValueError):
                portal.response_variant({'response': 0, 'uris': uris})

    def test_cancellation_returns_no_files(self):
        self.assertEqual(portal.response_variant({'response': 1, 'uris': ['file:///ignored']}).unpack(), (1, {}))


if __name__ == '__main__':
    unittest.main()
