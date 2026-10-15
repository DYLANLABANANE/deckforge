# Génère les icônes de l'application (PWA) et l'image d'aperçu des liens (og.png).
# usage: python tools/make_images.py   (nécessite Pillow)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
APP = os.path.join(ROOT, 'assets', 'app')
OG = os.path.join(ROOT, 'assets', 'og')
FONT = os.path.join(APP, 'LilitaOne-Regular.ttf')
BG = (19, 16, 29)
GOLD = (255, 199, 86)
INK = (241, 236, 255)
MUTE = (169, 159, 196)
ELS = [(196, 107, 255), (127, 227, 242), (252, 135, 62), (243, 238, 219)]  # ombre, eau, feu, lumière


def rounded(size, radius, fill, outline=None, width=0):
    im = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill, outline=outline, width=width)
    return im


def icon(size, maskable=False):
    s = size
    im = Image.new('RGBA', (s, s), BG + (255,))
    if not maskable:
        im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        im.alpha_composite(rounded((s, s), int(s * 0.22), BG + (255,)))
    zone = 0.62 if maskable else 0.78          # zone utile (les icônes « maskable » sont rognées en cercle)
    cw, ch = int(s * zone * 0.42), int(s * zone * 0.42 * 128 / 90)
    cx, cy = s / 2, s / 2 + s * 0.04
    for i, (ang, col) in enumerate(zip([-27, -9, 9, 27], ELS)):
        card = Image.new('RGBA', (cw + 8, ch + 8), (0, 0, 0, 0))
        front = i == 3
        card.alpha_composite(rounded((cw, ch), int(cw * 0.14), col + (255,), GOLD + (255,) if front else (19, 16, 29, 255), max(2, int(s * 0.012))), (4, 4))
        # fenêtre d'illustration (calque séparé, mélangé par alpha)
        win = Image.new('RGBA', card.size, (0, 0, 0, 0))
        ImageDraw.Draw(win).rounded_rectangle([4 + cw * 0.13, 4 + ch * 0.09, 4 + cw * 0.87, 4 + ch * 0.6], radius=int(cw * 0.08), fill=(19, 16, 29, 90))
        card.alpha_composite(win)
        rot = card.rotate(-ang, resample=Image.BICUBIC, expand=True)
        off_x = (i - 1.5) * s * 0.075
        im.alpha_composite(rot, (int(cx - rot.width / 2 + off_x), int(cy - rot.height / 2 + abs(i - 1.5) * s * 0.02)))
    return im


def og_image():
    W, H = 1200, 630
    im = Image.new('RGBA', (W, H), BG + (255,))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.45, -260, W * 1.25, 380], fill=(196, 107, 255, 70))
    gd.ellipse([-200, 300, 500, 900], fill=(255, 199, 86, 35))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    import json
    cards = json.load(open(os.path.join(ROOT, 'data', 'cards.fr.json'), encoding='utf-8'))['cards']
    meta = json.load(open(os.path.join(ROOT, 'src', 'meta.json'), encoding='utf-8'))
    by_id = {c['id']: c for c in cards}
    deck = [by_id[i] for i in meta['decks'][0]['cards']]
    cw, ch = 190, int(190 * 1024 / 716)
    step = 130
    x0, y0 = W - 48 - (cw + 3 * step), (H - ch) // 2 - 10
    colors = {'fire': (252, 135, 62), 'water': (127, 227, 242), 'earth': (201, 164, 137), 'nature': (166, 196, 75), 'light': (243, 238, 219), 'shadow': (196, 107, 255)}
    for i, c in enumerate(deck):
        f = os.path.join(OG, os.path.basename(c['artwork']['small']))
        if not os.path.exists(f):
            continue
        a = Image.open(f).convert('RGBA').resize((cw, ch), Image.LANCZOS)
        mask = rounded((cw, ch), 16, (255, 255, 255, 255))
        card = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        card.paste(a, (0, 0), mask)
        card.alpha_composite(rounded((cw, ch), 16, None, colors.get(c['element'], GOLD) + (255,), 4))
        rot = card.rotate((1.5 - i) * 5, resample=Image.BICUBIC, expand=True)
        shadow = Image.new('RGBA', rot.size, (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 150), (0, 0), rot)
        im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)), (int(x0 + i * step + 6), int(y0 + abs(i - 1.5) * 10 + 10)))
        im.alpha_composite(rot, (x0 + i * step, int(y0 + abs(i - 1.5) * 10)))
    artists = ', '.join(dict.fromkeys(c['artwork']['artist']['name'].strip() for c in deck if c.get('artwork', {}).get('artist')))
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(FONT, 96)
    mid = ImageFont.truetype(FONT, 40)
    d.text((56, 150), 'Deck', font=big, fill=INK)
    wdeck = d.textlength('Deck', font=big)
    d.text((56 + wdeck, 150), 'forge', font=big, fill=GOLD)
    d.text((58, 270), 'Optimiseur de decks', font=mid, fill=INK)
    d.text((58, 318), 'pour SPAM', font=mid, fill=INK)
    small = ImageFont.truetype(FONT, 24)
    d.text((58, 400), 'Coche tes cartes, obtiens ton meilleur deck,', font=small, fill=MUTE)
    d.text((58, 432), 'testé sur des milliers de parties simulées', font=small, fill=MUTE)
    tiny = ImageFont.truetype(FONT, 18)
    d.text((58, H - 70), 'Projet de fan non officiel, sans lien avec Ticroco', font=tiny, fill=(125, 115, 153))
    d.text((58, H - 44), 'Illustrations : ' + artists, font=tiny, fill=(125, 115, 153))
    return im.convert('RGB')


if __name__ == '__main__':
    for n in (192, 512):
        icon(n).save(os.path.join(APP, f'icon-{n}.png'))
    icon(512, maskable=True).save(os.path.join(APP, 'icon-maskable-512.png'))
    icon(180, maskable=True).convert('RGB').save(os.path.join(APP, 'apple-touch-icon.png'))
    icon(64).save(os.path.join(APP, 'favicon-64.png'))
    og_image().save(os.path.join(APP, 'og.png'), optimize=True)
    for f in sorted(os.listdir(APP)):
        print(f, os.path.getsize(os.path.join(APP, f)))
