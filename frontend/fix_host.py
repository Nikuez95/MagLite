import os
import glob
import re

def replace_in_files():
    frontend_dir = r"d:\MagLite\frontend\src"
    jsx_files = glob.glob(os.path.join(frontend_dir, "**", "*.jsx"), recursive=True)
    js_files = glob.glob(os.path.join(frontend_dir, "**", "*.js"), recursive=True)
    
    all_files = jsx_files + js_files
    for filepath in all_files:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        if "http://localhost:3000" in content:
            # We must be careful because of quotes.
            # 'http://localhost:3000' -> `http://${window.location.hostname}:3000`
            # "http://localhost:3000" -> `http://${window.location.hostname}:3000`
            # `http://localhost:3000/api/...` -> `http://${window.location.hostname}:3000/api/...`
            
            # 1. Replace single quotes
            new_content = re.sub(r"'http://localhost:3000/([^']*)'", r"`http://${window.location.hostname}:3000/\1`", content)
            new_content = new_content.replace("'http://localhost:3000'", "`http://${window.location.hostname}:3000`")
            
            # 2. Replace double quotes
            new_content = re.sub(r'"http://localhost:3000/([^"]*)"', r"`http://${window.location.hostname}:3000/\1`", new_content)
            new_content = new_content.replace('"http://localhost:3000"', "`http://${window.location.hostname}:3000`")
            
            # 3. Replace backticks
            new_content = new_content.replace("http://localhost:3000", "http://${window.location.hostname}:3000")
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated {filepath}")

replace_in_files()
