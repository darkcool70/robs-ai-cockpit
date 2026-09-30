# Renders the app logo: a black circle with a green "R" (assets/logo.png, 1024 px, transparent).
# Then: pnpm tauri icon assets/logo.png   (all window/installer icons)
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
SCALE = 4  # supersampling for smooth edges
GREEN = (34, 214, 110, 255)
root = Path(__file__).resolve().parent.parent

big = SIZE * SCALE
img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pad = int(big * 0.02)
# Thin dark-grey rim so the black circle stays visible on dark taskbars.
d.ellipse([pad, pad, big - pad, big - pad], fill=(46, 46, 46, 255))
rim = int(big * 0.018)
d.ellipse([pad + rim, pad + rim, big - pad - rim, big - pad - rim], fill=(0, 0, 0, 255))

font = None
for name in ("segoeuib.ttf", "arialbd.ttf"):
    try:
        font = ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), int(big * 0.62))
        break
    except OSError:
        pass
font = font or ImageFont.load_default()
box = d.textbbox((0, 0), "R", font=font)
w, h = box[2] - box[0], box[3] - box[1]
d.text(((big - w) / 2 - box[0], (big - h) / 2 - box[1]), "R", font=font, fill=GREEN)

out = img.resize((SIZE, SIZE), Image.LANCZOS)
out.save(root / "assets" / "logo.png")
out.resize((256, 256), Image.LANCZOS).save(root / "src" / "logo.png")
print("written", root / "assets" / "logo.png")
