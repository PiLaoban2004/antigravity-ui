import { describe, expect, test } from 'bun:test';
import { parseListenPorts, parseLsProcesses } from './language-server';

describe('parseLsProcesses', () => {
  const ps = [
    '    1 /sbin/launchd',
    '73842 /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --override_ide_name antigravity --override_ide_version 2.21.1 --https_server_port 0 --csrf_token 0a1b2c3d-4e5f-6789-abcd-ef0123456789 --app_data_dir antigravity',
    '73900 /Applications/Antigravity.app/Contents/Resources/bin/language_server --csrf_token=ffffffff-0000-1111-2222-333344445555',
    '74000 /Applications/Antigravity.app/Contents/Resources/bin/language_server --no-token-here',
    '74100 /usr/bin/other --csrf_token deadbeef',
    '74200 helper --extension_server_csrf_token 99999999-aaaa-bbbb-cccc-dddddddddddd --foo language_server',
  ].join('\n');

  test('extracts pid, csrf and IDE version; handles = and space forms', () => {
    const procs = parseLsProcesses(ps);
    expect(procs).toEqual([
      { pid: 73842, csrf: '0a1b2c3d-4e5f-6789-abcd-ef0123456789', ideVersion: '2.21.1' },
      { pid: 73900, csrf: 'ffffffff-0000-1111-2222-333344445555', ideVersion: undefined },
    ]);
  });

  test('ignores other processes, missing tokens, and the extension-server token flag', () => {
    expect(parseLsProcesses(ps).map((p) => p.pid)).not.toContain(74200);
    expect(parseLsProcesses('')).toEqual([]);
  });
});

describe('parseListenPorts', () => {
  test('reads LISTEN lines, dedupes', () => {
    const lsof = [
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'language_ 73842 u 10u IPv4 0x1 0t0 TCP 127.0.0.1:51921 (LISTEN)',
      'language_ 73842 u 11u IPv4 0x2 0t0 TCP 127.0.0.1:51922 (LISTEN)',
      'language_ 73842 u 12u IPv6 0x3 0t0 TCP [::1]:51921 (LISTEN)',
      'language_ 73842 u 13u IPv4 0x4 0t0 TCP 127.0.0.1:51921->127.0.0.1:60000 (ESTABLISHED)',
    ].join('\n');
    expect(parseListenPorts(lsof)).toEqual([51921, 51922]);
  });
});
