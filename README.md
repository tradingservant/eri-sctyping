# 練習打中文速成

呢個網頁幫你記熟常用中文字嘅速成碼。用電腦鍵盤打，字大，睇得清楚。

速成只取倉頡碼嘅頭尾兩粒字母。倉頡得一粒字母嘅字，速成都係一粒。

## 打開網頁

用電腦嘅 Chrome 或者 Edge 打開：

https://tradingservant.github.io/eri-sctyping/

呢個網址要等 GitHub Pages 開咗先至用到。開法（主人做一次就得）：

1. 打開呢個專案嘅 Settings
2. 左邊揀 Pages
3. Branch 揀 `main`，資料夾揀 `/ (root)`
4. 儲存，等一兩分鐘

頁面係普通 HTML，唔使裝 Node，亦唔使 build。

## 點樣練習

1. 中間有一個大字。
2. 將輸入法轉做速成（Windows 嘅「速成」或者「速成輸入法」）。
3. 喺個格入面打出嗰個字。候選字用 Windows 自己嗰個視窗，呢個網頁唔會再列出 1 至 9。
4. 打出嚟嘅字同題目一樣：綠色「✓ 答對」，並顯示速成碼同字根，例如 `我 = HI（竹戈）`。再撳 Space 去下一題。
5. 打錯：紅色「× 唔對，再試一次」，個字會入複習。你可以再打。

每組 50 題。做完可以去下一組，或者再練同一組。而家預設練最常用嘅 300 個字。

## 鍵盤

| 鍵 | 做咩 |
| --- | --- |
| Space | 答對之後去下一題。呢組做完之後，Space 會去下一組。輸入法揀字嗰下，Space 仍然交俾 Windows |
| Esc | 清除格入面嘅字。字根表開住嘅時候，Esc 係關閉 |
| Tab | 先睇頭碼，再撳一次就睇完整速成碼。睇過完整答案先打啱，個字會留喺複習 |
| ? | 打開 24 個字根表 |

## 右邊

- **睇字根表**：26 個鍵對應嘅字根。Y 係「卜」，唔係日文「ト」。
- **複習**：打錯或者睇過答案嘅字會入嚟。自己打啱就會喺清單度刪走。如果係睇完答案先打啱，個字會留低，等你遲啲再試。
- **重新開始**：呢組由頭再嚟。今日嘅紀錄同複習清單唔會刪。

上面係今次嘅答對數、準確率、連勝。右邊下面係今日練咗幾多，同最常打錯嘅字。紀錄留喺你部電腦，唔會上傳。

## 安裝到電腦（離線都用得）

第一次要有網路，等佢下載好。之後冇網路都開到。

Chrome 或 Edge（Windows 或 Mac）：

1. 打開上面個網址
2. 網址列右邊會有個安裝圖示（一個螢幕加一支箭嘴）
3. 撳「安裝」
4. 之後可以喺開始功能表或者應用程式列表打開「速成練習」

手機只係盡量唔會爛版，主要係俾電腦用。

## 速成碼係點來

| 字 | 倉頡 | 速成 |
| --- | --- | --- |
| 倉 | OIAR | OR（人口） |
| 我 | HQI | HI |
| 日 | A | A |
| 明 | AB | AB（日月） |

字根：A日 B月 C金 D木 E水 F火 G土 H竹 I戈 J十 K大 L中 M一 N弓 O人 P心 Q手 R口 S尸 T廿 U山 V女 W田 X難 Y卜 Z重。

碼表來自 Rime 嘅倉頡五代（`cangjie5.base.dict.yaml`）。速成係取頭尾兩碼，同 Rime 速成方案一樣。兩個專案都係 **GNU LGPL 3.0**。詳情同出處喺 [data/SOURCE.md](data/SOURCE.md)。

常用字次序用國家教育研究院《臺灣華語文能力基準》漢字表（2022-09-20）嘅書面字頻，由常用到少用。

## 想練多啲字

用文字編輯器打開 `data/characters.json`。最上面有：

```json
"practiceSize": 300
```

將 `300` 改成 `500`（或者 `1000`，最多去到檔案入面嘅字數）然後儲存。字同速成碼已經喺檔案入面，唔使再計。

想由源頭重新產生字表，先有網路，再喺專案資料夾執行：

```bash
python3 data/build_characters.py
```

## 檔案

| 檔案 | 係咩 |
| --- | --- |
| `index.html` | 網頁 |
| `styles.css` | 樣式 |
| `app.js` | 練習 |
| `sw.js` | 離線 |
| `manifest.webmanifest` | 安裝成 app |
| `data/` | 字表、字根、來源說明 |

## English

A static page for practising Sucheng (速成), the two-letter form of Cangjie 5. The target character is shown, and you type it with the operating system's Sucheng or Quick input method. The page reads the composed Chinese character and marks it correct only when it matches. It does not show its own 1–9 candidate bar. After a correct answer, the Sucheng code and radicals are shown, and Space goes to the next question. Open it in desktop Chrome or Edge, install it from the address bar, and it works offline after the first visit. Paths are relative so GitHub Pages can serve it from `/eri-sctyping/`.

Codes are derived from the Rime `cangjie5` table: the first and last letter, or the single letter when the Cangjie code is only one letter. The Rime cangjie and quick projects are LGPL-3.0. See `data/SOURCE.md`.
