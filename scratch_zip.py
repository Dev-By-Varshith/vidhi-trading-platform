import os
import zipfile

def is_excluded(path):
    norm_path = path.replace('\\', '/').lower()
    
    excluded_folders = [
        '/.git/',
        '/node_modules/',
        '/gopath/',
        '/test_extract/',
        '/build_tests/',
        '/dist/',
        '/.gemini/',
    ]
    for folder in excluded_folders:
        if folder in norm_path:
            return True
            
    filename = os.path.basename(norm_path)
    
    if filename.endswith(('.zip', '.exe', '.bin', '.arrow', '.csv', '.o', '.a', '.so')):
        return True
        
    if filename in ['vidhi-backend', 'sandbox-manager_linux', 'vidhi-control', 'scratch_zip.ps1', 'scratch_zip.py']:
        return True
        
    return False

source_dir = r"c:\Users\varsh\IICPC_ALGO_TRADING_PLATFORM"
output_zip = r"c:\Users\varsh\IICPC_ALGO_TRADING_PLATFORM\vidhi_aws_deploy_clean.zip"

if os.path.exists(output_zip):
    os.remove(output_zip)

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zip_file:
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, source_dir)
            if is_excluded(rel_path) or is_excluded('/' + rel_path):
                continue
            zip_file.write(full_path, rel_path)

size_mb = os.path.getsize(output_zip) / (1024 * 1024)
print(f"Success! Zip updated size: {size_mb:.2f} MB")
