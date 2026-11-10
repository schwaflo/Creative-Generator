"""Tests für server.py (Standardbibliothek).
Start:  python3 -m unittest tests/test_server.py -v
"""
import json
import os
import socket
import sys
import threading
import unittest
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.srv.server_address[1]
        cls.base = 'http://127.0.0.1:%d' % cls.port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=5) as r:
            return r.status, r.headers, r.read()

    def test_static_files(self):
        s, h, body = self.get('/index.html')
        self.assertEqual(s, 200)
        self.assertIn(b'Creative Generator', body)
        self.assertEqual(h.get('Cache-Control'), 'no-cache')
        s, _, body = self.get('/config.json')
        self.assertIn('visionModel', json.loads(body))

    def test_instance_detection(self):
        self.assertTrue(server.already_running(self.port))
        free = socket.socket(); free.bind(('127.0.0.1', 0)); p = free.getsockname()[1]; free.close()
        self.assertFalse(server.already_running(p))

    def test_no_api_left(self):
        # die App spricht direkt mit dem KI-Server – hier gibt es keine API mehr
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.get('/api/health')
        self.assertEqual(cm.exception.code, 404)
        cm.exception.close()


if __name__ == '__main__':
    unittest.main()
