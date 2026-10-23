import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'native_inspector', ROOT / 'tests/native/selection-deletion/native-check.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class InspectorSocket:
    def __init__(self, fail_page=False):
        self.requests = []
        self.fail_page = fail_page

    def send(self, message):
        outer = json.loads(message)
        self.requests.append(json.loads(outer['params']['message']))

    def recv(self):
        if not self.requests:
            return json.dumps({'method': 'Target.targetCreated', 'params': {
                'targetInfo': {'type': 'page', 'targetId': 'test-page'}}})
        request = self.requests[-1]
        response = {'id': request['id'], 'result': {}}
        if self.fail_page and request['method'] == 'Page.enable':
            response = {'id': request['id'], 'error': {'message': 'Page unavailable'}}
        return json.dumps({'method': 'Target.dispatchMessageFromTarget',
                           'params': {'message': json.dumps(response)}})

    @property
    def methods(self):
        return [request['method'] for request in self.requests]


class NativeInspectorTests(unittest.TestCase):
    def connect(self, fail_page=False):
        socket = InspectorSocket(fail_page)
        with patch.object(native.websocket, 'create_connection', return_value=socket):
            client = native.Native()
        return client, socket

    def test_css_inspection_enables_page_first(self):
        client, socket = self.connect()
        client.call('CSS.enable', {})
        self.assertEqual(socket.methods, ['Page.enable', 'CSS.enable'])
        self.assertEqual([request['id'] for request in socket.requests], [1, 2])

    def test_javascript_checks_do_not_enable_css_or_page_inspection(self):
        client, socket = self.connect()
        client.call('Runtime.evaluate', {'expression': '1 + 1'})
        self.assertEqual(socket.methods, ['Runtime.evaluate'])

    def test_css_inspection_reuses_enabled_page(self):
        client, socket = self.connect()
        client.call('Page.enable', {})
        client.call('CSS.enable', {})
        self.assertEqual(socket.methods, ['Page.enable', 'CSS.enable'])

    def test_css_inspection_reenables_page_after_disable(self):
        client, socket = self.connect()
        client.call('Page.enable', {})
        client.call('Page.disable', {})
        client.call('CSS.enable', {})
        self.assertEqual(socket.methods,
                         ['Page.enable', 'Page.disable', 'Page.enable', 'CSS.enable'])

    def test_failed_page_enable_never_sends_css_enable(self):
        client, socket = self.connect(fail_page=True)
        with self.assertRaisesRegex(Exception, 'Page unavailable'):
            client.call('CSS.enable', {})
        self.assertEqual(socket.methods, ['Page.enable'])


if __name__ == '__main__':
    unittest.main()
