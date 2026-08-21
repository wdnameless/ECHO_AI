import urllib.request
import re
import json
import xml.etree.ElementTree as ET
import html

url = 'https://www.youtube.com/watch?v=IKXbAmvSdlk'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})

try:
    with urllib.request.urlopen(req) as resp:
        page_html = resp.read().decode('utf-8', errors='ignore')

    # Look for timedtext URLs
    urls = re.findall(r'https://www.youtube.com/api/timedtext[^\",\\]+', page_html)
    print(f"Found {len(urls)} timedtext URLs")
    if urls:
        cap_url = urls[0].replace('\\u0026', '&')
        cap_req = urllib.request.Request(cap_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(cap_req) as cap_resp:
            xml_data = cap_resp.read().decode('utf-8', errors='ignore')
        
        root = ET.fromstring(xml_data)
        lines = []
        for elem in root.iter('text'):
            start = float(elem.attrib.get('start', 0))
            dur = float(elem.attrib.get('dur', 0))
            raw_text = elem.text or ''
            clean_text = html.unescape(raw_text).strip()
            if 2150 <= start <= 2700:
                mins = int(start // 60)
                secs = int(start % 60)
                lines.append(f"[{mins:02d}:{secs:02d}] {clean_text}")

        output = "\n".join(lines)
        with open('D:/transcript_segment.txt', 'w', encoding='utf-8') as f:
            f.write(output)
        print("Successfully written transcript segment! Sample:")
        print("\n".join(lines[:35]))
    else:
        print("No caption tracks found in direct scrape, trying yt-dlp/fallback...")
except Exception as e:
    print(f"Error fetching: {e}")
