"""Скачивает фирменные шрифты для карточек. Запускать один раз:
    python tools/cards/fonts.py
Шрифты в репозиторий не кладём — они свободные и берутся у Google.
"""
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fonts")
os.makedirs(OUT, exist_ok=True)

WANTED = {
    "Michroma.ttf": "https://fonts.googleapis.com/css2?family=Michroma&display=swap",
    "Rubik-Bold.ttf": "https://fonts.googleapis.com/css2?family=Rubik:wght@700&display=swap",
    "Rubik-Medium.ttf": "https://fonts.googleapis.com/css2?family=Rubik:wght@500&display=swap",
    "PlexMono.ttf": "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&display=swap",
}

# без современного User-Agent Google отдаёт woff2, а Pillow его не читает
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

for name, css_url in WANTED.items():
    dest = os.path.join(OUT, name)
    if os.path.exists(dest):
        print("уже есть:", name)
        continue
    css = urllib.request.urlopen(urllib.request.Request(css_url, headers=UA), timeout=30).read().decode()
    urls = re.findall(r"url\((https://[^)]+\.ttf)\)", css)
    if not urls:
        print("не нашёл ttf для", name)
        continue
    data = urllib.request.urlopen(urllib.request.Request(urls[0], headers=UA), timeout=30).read()
    with open(dest, "wb") as f:
        f.write(data)
    print("скачан:", name, len(data), "байт")
