"""Generates the extension's toolbar icons from the user-supplied microphone artwork
(Img/Vintage Chrome Studio Microphone.png): crops tightly to the mic's silhouette (so it
reads clearly at 16px) onto a square transparent canvas, then downsamples for crisp edges
at every size. Run once, not shipped/loaded by the extension."""
from PIL import Image

SRC = "../Img/Vintage Chrome Studio Microphone.png"
PAD = 0.08  # fraction of the glyph's size to pad on each side

src = Image.open(SRC).convert("RGBA")
bbox = src.getbbox()  # tight box around the non-transparent (badge) pixels
glyph = src.crop(bbox)

w, h = glyph.size
side = max(w, h)
pad = int(side * (1 + PAD * 2))
canvas = Image.new("RGBA", (pad, pad), (0, 0, 0, 0))
canvas.paste(glyph, ((pad - w) // 2, (pad - h) // 2), glyph)

for size in (16, 32, 48, 128):
    canvas.resize((size, size), Image.LANCZOS).save(f"icon{size}.png")
print("done", canvas.size)
