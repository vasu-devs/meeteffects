#!/usr/bin/env python3
"""Fetch only pinned local segmentation assets; no npm install or archive unpacking.

Use --check for offline integrity verification, or --from-dir DIR for an already
downloaded, checksum-verified source directory. Network is used only by this
developer command, never by the extension.
"""
import argparse
import hashlib
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'extension' / 'vendor'
CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/'
ASSETS = [
    ('vision_bundle.cjs', 'vision-bundle.js', CDN + 'vision_bundle.cjs', 137890,
     'bf58c9b3f592304422947b51e1f7de360c67d4dfeaa900064352da0c5a7c9115'),
    ('vision_wasm_internal.js', 'vision_wasm_internal.js', CDN + 'wasm/vision_wasm_internal.js', 204284,
     '4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb'),
    ('vision_wasm_internal.wasm', 'vision_wasm_internal.wasm', CDN + 'wasm/vision_wasm_internal.wasm', 9574032,
     'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7'),
    ('selfie_segmenter_landscape.tflite', 'selfie_segmenter_landscape.tflite',
     'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite',
     250177, '490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e'),
    ('LICENSE', 'LICENSE', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE',
     12331, '8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8'),
    ('package.json', 'package.json', CDN + 'package.json', 592,
     '18e96c370b666f1f6b096c96255f19a4750522d207cff5dc721aeb4c4e4da701'),
]
PREFIX = b'/* MediaPipe Tasks Vision 0.10.21, Apache-2.0. Classic-script wrapper; upstream body unchanged. */\n(() => { const exports = {};\n'
SUFFIX = b'\nglobalThis.MeetEffectsVision = exports; })();\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--from-dir', type=Path)
    args = parser.parse_args()
    receipts = []
    for source, target, url, size, digest in ASSETS:
        if args.check:
            output = (DEST / target).read_bytes()
            if source.endswith('.cjs'):
                if not output.startswith(PREFIX) or not output.endswith(SUFFIX):
                    raise ValueError('Unexpected classic-script wrapper')
                raw = output[len(PREFIX):-len(SUFFIX)]
            else:
                raw = output
        else:
            if args.from_dir:
                raw = (args.from_dir / source).read_bytes()
            else:
                with urllib.request.urlopen(url, timeout=30) as response:
                    raw = response.read(size + 1)
            output = PREFIX + raw + SUFFIX if source.endswith('.cjs') else raw
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError(f'Integrity mismatch: {source}')
        if not args.check:
            DEST.mkdir(parents=True, exist_ok=True)
            (DEST / target).write_bytes(output)
        receipts.append(f'{hashlib.sha256(output).hexdigest()}  {target}\n')
    receipt = ''.join(receipts)
    if args.check:
        if (DEST / 'SHA256SUMS').read_text() != receipt:
            raise ValueError('SHA256SUMS mismatch')
    else:
        (DEST / 'SHA256SUMS').write_text(receipt)
    total = sum(p.stat().st_size for p in DEST.rglob('*') if p.is_file())
    if total > 20 * 1024 * 1024:
        raise ValueError('Vendor allocation exceeded 20 MiB')
    print(f'Verified {len(ASSETS)} pinned assets; vendor bytes: {total}')


if __name__ == '__main__':
    main()
