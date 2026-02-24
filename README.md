# 🎬 Video Reup Tool

Auto reup YouTube Shorts → YouTube Channel & Facebook Page Reels.

**Tính năng chính:**

- 🔍 Tự động tìm video trending trên YouTube
- 📥 Tải video bằng yt-dlp
- 📤 Upload lên YouTube (API) + Facebook (Browser automation)
- 📝 Tự động thêm description + hashtags chuẩn
- ⏱️ Rate limiting để tránh bị ban
- 🚀 Auto-Pilot mode: bật lên là chạy liên tục
- 📊 Web Dashboard quản lý trực quan

## Yêu Cầu

- **Node.js** >= 20
- **yt-dlp** - [Install](https://github.com/yt-dlp/yt-dlp#installation)
- **FFmpeg** - [Install](https://ffmpeg.org/download.html)

### Cài yt-dlp (Windows)

```bash
# Dùng pip
pip install yt-dlp

# Hoặc dùng winget
winget install yt-dlp

# Hoặc dùng scoop
scoop install yt-dlp
```

### Cài FFmpeg (Windows)

```bash
winget install FFmpeg
# hoặc
scoop install ffmpeg
```

## Cài Đặt

```bash
cd video-reup-tool
npm install
npx playwright install chromium  # Cho Facebook browser auth
```

## Cấu Hình

Copy `.env.example` → `.env` và điền thông tin:

```env
# YouTube API (xem hướng dẫn bên dưới)
YOUTUBE_CLIENT_ID=xxx
YOUTUBE_CLIENT_SECRET=xxx

# Rate Limiting
UPLOAD_INTERVAL_MINUTES=5
MAX_UPLOADS_PER_DAY=50

# Auto-Pilot
AUTOPILOT_INTERVAL_MINUTES=10
AUTOPILOT_CATEGORIES=entertainment,music,gaming,comedy
```

## Sử Dụng Nhanh

### 1. Login

```bash
# YouTube (OAuth2 API)
node src/cli/index.js auth login youtube

# Facebook (Browser - mở trình duyệt để login)
node src/cli/index.js auth login facebook

# Facebook (Cookie import)
node src/cli/index.js auth login facebook --cookies ./cookies.json
```

### 2. Download & Upload thủ công

```bash
# Tải 1 video
node src/cli/index.js download https://youtube.com/shorts/xxx

# Tải từ channel
node src/cli/index.js download-channel https://youtube.com/@channel/shorts --limit 10

# Upload lên YouTube
node src/cli/index.js upload youtube ./downloads/video.mp4

# Upload lên Facebook
node src/cli/index.js upload facebook ./downloads/video.mp4

# Combo: download + upload
node src/cli/index.js reup https://youtube.com/shorts/xxx --to youtube,facebook
```

### 3. Auto-Pilot 🚀 (Khuyên dùng)

```bash
# Bật auto-pilot (tìm trending → tải → upload liên tục)
node src/cli/index.js autopilot

# Với tùy chỉnh
node src/cli/index.js autopilot --interval 10 --categories entertainment,music --to youtube,facebook
```

### 4. Web Dashboard

```bash
node src/cli/index.js dashboard
# Mở http://localhost:3000
```

### 5. Batch reup

```bash
# Tạo file urls.txt với mỗi dòng 1 URL
node src/cli/index.js batch urls.txt --to youtube,facebook
```

---

## 📋 Hướng Dẫn Setup API

### YouTube - Google Cloud Console

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo Project mới (hoặc dùng project hiện có)
3. Vào **APIs & Services** → **Enable APIs**
4. Tìm và Enable **YouTube Data API v3**
5. Vào **APIs & Services** → **Credentials**
6. Click **Create Credentials** → **OAuth client ID**
7. Chọn **Application type: Desktop app**
8. Đặt tên (VD: "Video Reup Tool")
9. Copy **Client ID** và **Client Secret** vào `.env`

```env
YOUTUBE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

10. Vào **OAuth consent screen** → thêm test user (email của bạn)
11. Chạy `node src/cli/index.js auth login youtube`
12. Mở link → Đăng nhập → Copy code → Paste vào terminal

> **Quota:** 10,000 units/ngày. Mỗi upload = ~100 units → ~100 video/ngày

### Facebook - Browser Auth (Khuyên dùng)

Cách đơn giản nhất, không cần tạo App:

```bash
node src/cli/index.js auth login facebook
```

Playwright sẽ mở browser → bạn login Facebook → cookies tự được lưu.

### Facebook - Graph API (Nâng cao)

Nếu muốn dùng API chính thức:

1. Truy cập [developers.facebook.com](https://developers.facebook.com/)
2. Tạo App mới → Chọn **Business** type
3. Vào **Add Products** → thêm **Facebook Login**
4. Cấu hình **Settings** → **Basic**:
   - Copy **App ID** và **App Secret** vào `.env`
5. Vào **Tools** → **Graph API Explorer**:
   - Chọn Page của bạn
   - Xin quyền: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`
   - Generate **Page Access Token**
   - Copy token vào `.env`

```env
FACEBOOK_APP_ID=xxxxxxxxxxxx
FACEBOOK_APP_SECRET=xxxxxxxxxxxx
FACEBOOK_PAGE_ID=xxxxxxxxxxxx
FACEBOOK_PAGE_ACCESS_TOKEN=EAAxxxxxxxxxxxx
```

> ⚠️ App cần qua review nếu dùng production. Dùng browser auth để bypass.

### Facebook - Cookie Import

Nếu đã có cookies (export từ browser extension):

1. Cài extension: **Cookie-Editor** hoặc **EditThisCookie**
2. Đăng nhập Facebook trong browser
3. Export cookies ra file JSON
4. Import:

```bash
node src/cli/index.js auth login facebook --cookies ./fb-cookies.json
```

---

## 📊 Dashboard

Mở dashboard bằng:

```bash
node src/cli/index.js dashboard
```

Dashboard bao gồm:

- **Dashboard**: Tổng quan stats
- **Auto-Pilot**: Điều khiển auto-pilot từ giao diện
- **Uploads**: Lịch sử upload
- **Reup Manual**: Upload thủ công từ URL
- **Accounts**: Quản lý tài khoản
- **Logs**: Xem logs real-time

## Cấu Trúc

```
video-reup-tool/
├── src/
│   ├── cli/index.js           # CLI commands
│   ├── core/                  # Config, DB, Logger
│   ├── downloader/            # yt-dlp wrapper
│   ├── uploader/              # YT API + FB Browser/API
│   ├── auth/                  # Auth manager (hybrid)
│   ├── processor/             # Content optimization
│   ├── scheduler/             # Job queue + rate limiter
│   ├── autopilot/             # Auto-pilot engine
│   └── dashboard/             # Express + Web UI
├── downloads/                 # Downloaded videos
├── data/                      # SQLite DB, logs
├── .env                       # Config (secrets)
└── package.json
```

## License

MIT
