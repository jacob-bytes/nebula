#!/usr/bin/env python3
"""静态检查：shell 脚本中 `$VAR` 后面紧跟非 ASCII 字符。

原因：bash 在 UTF-8 locale 下可能把该字符并入变量名，`set -u` 时直接报
`unbound variable` 并以非预期退出码结束。实测已两次踩到（发布脚本、备份脚本），
因此做成检查而不是靠人工记。

修复方式：写成 `${VAR}`。
"""
import pathlib
import re
import sys

PATTERN = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7F])')
ROOT = pathlib.Path(__file__).resolve().parents[2]
SKIP_PARTS = {'.git', 'node_modules', 'dist', 'telegram-bot-api'}


def main() -> int:
    offenders = []
    for path in sorted(ROOT.rglob('*.sh')):
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        for lineno, line in enumerate(text.splitlines(), 1):
            for match in PATTERN.finditer(line):
                offenders.append((path.relative_to(ROOT), lineno, match.group(0), line.strip()[:90]))

    if not offenders:
        print('[shell-var-braces] 通过：未发现 $VAR 紧跟非 ASCII 字符')
        return 0

    print('[shell-var-braces] 失败：以下位置应改写为 ${VAR}', file=sys.stderr)
    for path, lineno, token, snippet in offenders:
        print(f'  {path}:{lineno}  {token}  ← {snippet}', file=sys.stderr)
    print(f'共 {len(offenders)} 处', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
