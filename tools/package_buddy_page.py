"""Package only declared demo assets, without including local histories or config."""
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package_page(directory, output):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / 'manifest.json').read_text())
    pages = manifest.get('pages', [])
    if not 1 <= len(pages) <= 3:
        raise ValueError('Expected 1 to 3 pages')
    ids = [page.get('id', '') for page in pages]
    if len(set(ids)) != len(ids) or any(not value or value == 'workbench' or '/' in value or '\\' in value for value in ids):
        raise ValueError('Invalid page identifiers')
    names = {'manifest.json'}
    for page in pages:
        names.add(page['entry'])
        names.update(page.get('assets', []))
    for name in names:
        file = directory / name
        if '\\' in name or Path(name).is_absolute() or '..' in Path(name).parts or not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(directory):
            raise ValueError('Invalid or missing declared asset')
    if sum((directory / name).stat().st_size for name in names) > 20 * 1024 * 1024:
        raise ValueError('Page assets exceed package budget')
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name in sorted(names):
            archive.write(directory / name, name)
    return len(names)


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    count = package_page(root / 'dist/buddy-menu', root / 'dist/synapse-canvas-buddy-demo.zip')
    print(f'Buddy demo packaged: {count} declared files')
