# KiddoLens - 讓孩子只看你選好的 YouTube 頻道 🎈

**KiddoLens** 是一個專為家長與孩子設計的 YouTube 播放工具。在充滿大量演算法推薦、隨機影片的網路世界裡，我們提供一個安全、純淨的空間。在這裡，**孩子只能看到你親手挑選、審核過的頻道**。

🔗 **線上體驗**：[evelynytliu.github.io/kiddolens-for-youtube](https://evelynytliu.github.io/kiddolens-for-youtube/)

---

## ✨ 核心特色

- **✅ 白名單機制**：沒有「推薦影片」側邊欄，孩子無法連到你未允許的內容，徹底杜絕演算法兔子洞。
- **👦👧 多兒童檔案**：為每個孩子建立獨立的觀看頻道清單，輕鬆切換。頻道與檔案皆支援拖曳排序。
- **🎈 Lite Mode（免費）**：不需要任何 API Key，直接透過公開 RSS 摘要載入最新 15 部影片，零門檻開始使用。
- **🚀 Pro Mode（進階）**：輸入自己的 YouTube Data API v3 Key，解鎖無限影片數量、更精確的 Shorts 過濾與更快的同步速度。
- **📺 乾淨的觀看體驗**：無干擾的 UI 設計，適合幼兒操作。搭配 YouTube Premium 帳號可享無廣告體驗。
- **⏱️ 觀看時間控管**：內建每日觀看時間追蹤，快到上限時會溫馨提醒孩子該休息了。
- **📜 觀看紀錄**：每個檔案獨立記錄最近 50 部影片，清楚掌握孩子看了什麼。
- **🧠 智慧 Shuffle**：依據孩子近 14 天的觀看興趣，自動加權打亂影片排序，越愛看的頻道越常出現。
- **☁️ 跨裝置雲端同步**：透過 Supabase 帳號（Google 登入），在手機設定好的頻道可一鍵同步到平板或電視盒。
- **🚀 聰明省流 (API Optimization)**：內建 24 小時本地快取機制，大幅節省 YouTube API 呼叫次數。
- **📱 可安裝為 App (PWA)**：支援 Progressive Web App，可安裝到手機主畫面，像原生 App 一樣開啟使用（包含 iOS Safari）。
- **🏆 社群頻道排名**：頻道資料自動同步至社群資料庫，幫助其他家長發掘優質內容（匿名、無個人資訊）。

---

## 🚀 如何開始使用 (開發者必看)

如果你想要在本機執行或修改 KiddoLens：

1. **啟動專案**:
   - 安裝環境依賴：`npm i`
   - 在終端機執行：`npm run dev`
   - 開啟網頁：`http://localhost:5173`

2. **關於 Supabase 環境變數**:
   - 在專案根目錄建立 `.env` 檔（已加入 `.gitignore`，不會上傳 Git）
   - 填入以下兩個值：
     ```
     VITE_SUPABASE_URL=你的_supabase_url
     VITE_SUPABASE_ANON_KEY=你的_supabase_anon_key
     ```
   - 雲端部署（GitHub Actions）則改用 GitHub Secrets 注入，無需上傳 `.env`。

3. **關於 YouTube API 額度控制 (重要)**:
   - 預設開發環境會讀取 `.env` 中的 `VITE_USE_MOCK_YOUTUBE_API=true`。
   - 在此模式下，所有頻道搜尋與影片載入都會**使用假資料 (Mock Data)**，可以無限次重新整理而**不消耗任何 Google API 額度**。
   - 若要測試真實資料，請將值改為 `false`，並重新啟動 `npm run dev`。
   - 正常運作下，程式會將真實 API 回傳結果快取在瀏覽器 24 小時。若要強制更新，點擊右上角「重新整理」按鈕。

4. **初次設定流程**:
   - 首次開啟會進入**引導精靈（Onboarding Wizard）**，輸入孩子名字並挑選推薦的安全頻道，幾秒內完成初始設定。
   - 設定完成後，點擊右上角 **設定齒輪 ⚙️** 即可進入設定。
   - 選擇 **Lite Mode**（免費，無需 API Key）或 **Pro Mode**（需要 YouTube API v3 Key）。
   - 在「管理頻道」中搜尋並新增你想給孩子觀看的頻道。
   - 點擊右上角 Google 登入以開啟跨裝置雲端同步。

---

## 🛡️ 隱私與安全性聲明

- **不收集個人資料**：你的 YouTube API Key 存放在 Supabase 私人帳號中，僅限本人存取。核心功能完全在裝置端運作。
- **保護兒童**：徹底阻斷 YouTube 預設的無止盡推薦機制，把遙控器真正交還給爸媽。
- **開源透明**：完整程式碼公開於 GitHub，歡迎自行審閱或 Fork。

Enjoy peace of mind! 🧸 享受安心的育兒時光！
