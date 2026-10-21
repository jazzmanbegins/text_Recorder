# Text Recorder — Chrome Extension

อัดเสียงจากวิดีโอที่เล่นในแท็บ (YouTube, Udemy, Facebook ฯลฯ) → เก็บเป็นไฟล์เสียง `.webm` → ถอดเป็นข้อความด้วย Whisper → export `.txt` / `.srt`

## ติดตั้ง Extension
1. ดับเบิลคลิก `setup-lib.bat` เพื่อดาวน์โหลดไลบรารีลงโฟลเดอร์ `lib/` (ทำครั้งแรกครั้งเดียว ~27 MB)
2. เปิด `chrome://extensions`
3. เปิด **Developer mode** (มุมขวาบน)
4. กด **Load unpacked** แล้วเลือกโฟลเดอร์นี้

## วิธีใช้
1. เปิดหน้าวิดีโอ แล้วกดไอคอน extension → **เริ่มอัดเสียงแท็บนี้**
2. เล่นวิดีโอ (ปิด popup ได้ จะเห็น badge `REC` บนไอคอน)
3. กดไอคอนอีกครั้ง → **หยุดและบันทึก** — หน้ารายการไฟล์จะเปิดขึ้น
4. กด **ถอดเป็นข้อความ** แล้วคัดลอกหรือดาวน์โหลดเป็น `.txt` / `.srt`

## เลือกวิธีถอดเสียง (หน้าตั้งค่า ⚙️)

| วิธี | ต้องใช้ API Key | ติดตั้งเพิ่ม | หมายเหตุ |
|---|---|---|---|
| **ในเบราว์เซอร์** (ค่าเริ่มต้น) | ไม่ | ไม่ | โหลดโมเดลครั้งแรกครั้งเดียว ใช้การ์ดจอผ่าน WebGPU ถ้าใช้ได้ |
| **Local Server** | ไม่ | Python | แม่นที่สุด เร็วมากบนการ์ดจอ NVIDIA |
| Groq API | ใช่ (ฟรี) | ไม่ | จำกัดไฟล์ 25 MB |
| OpenAI API | ใช่ (เสียเงิน) | ไม่ | จำกัดไฟล์ 25 MB |

### 1) ในเบราว์เซอร์
เลือกโมเดลได้ 3 ขนาด: `large-v3-turbo` (~1.6 GB), `small` (~410 MB), `base` (~165 MB)

ถ้าหน้ารายการไฟล์ขึ้นว่า **"CPU (ช้ากว่า)"** แปลว่า Chrome ยังใช้การ์ดจอไม่ได้ ให้ตรวจดังนี้:
- `chrome://settings/system` → เปิด **Use graphics acceleration when available** แล้วรีสตาร์ท Chrome
- `chrome://gpu` → ดูว่าบรรทัด **WebGPU** เป็น *Hardware accelerated* หรือไม่
- ถ้ายังไม่ได้ ลองเปิด `chrome://flags/#enable-unsafe-webgpu` หรือตั้งให้ Chrome ใช้การ์ดจอ NVIDIA ใน Windows Settings → Display → Graphics
- ระหว่างที่ยังใช้ CPU แนะนำโมเดล `small` เพราะ `large-v3-turbo` บน CPU จะช้ามาก

### 2) Local Server (Whisper บนเครื่อง)
1. ต้องมี Python 3.10 ขึ้นไป และไดรเวอร์ NVIDIA เวอร์ชันใหม่ (ถ้าจะใช้การ์ดจอ)
2. ดับเบิลคลิก `local-server\start.bat`
   - ครั้งแรกจะสร้าง virtual env และติดตั้งแพ็กเกจ (~3 GB รวม CUDA libraries)
   - ครั้งแรกที่ถอดเสียงจะดาวน์โหลดโมเดล (`large-v3` ~3 GB)
3. เปิดหน้าต่างนี้ค้างไว้ แล้วในหน้าตั้งค่าเลือก **Local Server** → กด **ทดสอบ** ควรขึ้น `device: cuda`

ตั้งค่าเพิ่มเติมผ่าน environment variable: `PORT` (ค่าเริ่มต้น 8765), `WHISPER_DEVICE=cpu` (บังคับใช้ CPU)

## ข้อจำกัด
- ไฟล์เก็บใน IndexedDB ของ extension ถ้าลบ extension ไฟล์จะหายด้วย (ดาวน์โหลดเก็บไว้ก่อน)
- วิดีโอที่มี DRM บางเว็บ (เช่น Netflix) อาจอัดได้เป็นเสียงเงียบ
- โหมดในเบราว์เซอร์ตัดเสียงเป็นช่วงละไม่เกิน 30 วินาที (ตัดตรงจุดที่เงียบที่สุด) คำที่คร่อมรอยต่ออาจผิดได้บ้าง

## โครงสร้างไฟล์
- `background.js` / `offscreen.js` — จับเสียงจากแท็บและอัดด้วย MediaRecorder
- `db.js` — เก็บไฟล์เสียงและข้อความใน IndexedDB
- `transcribe.js` — เลือกวิธีถอดเสียง + export `.srt`
- `local-whisper.js` / `local-whisper-worker.js` — Whisper ในเบราว์เซอร์ (transformers.js)
- `lib/` — transformers.js และ ONNX Runtime Web (ใส่ไว้ในเครื่อง เพราะ MV3 ห้ามโหลดโค้ดจากภายนอก — ไม่อยู่ใน git ให้รัน `setup-lib.bat`)
- `local-server/` — เซิร์ฟเวอร์ faster-whisper แบบ OpenAI-compatible
