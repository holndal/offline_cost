# TECH.md — 技術解説

このドキュメントは「還元額サーチ」がどのように作られていて、なぜオフラインで動くのかを技術面から解説します。使い方は [README.md](./README.md) を参照してください。

## 1. アプリの全体構成

ビルドツールやフレームワークを使わない、素の HTML / CSS / JavaScript のみで作られた静的サイトです。

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面構造（検索フォームと結果一覧） |
| `styles.css` | 見た目 |
| `app.js` | CSV 読み込み・検索・還元額計算・描画ロジック |
| `sw.js` | Service Worker（オフライン対応の本体） |
| `manifest.webmanifest` | PWA のメタ情報（アイコン・アプリ名・表示モードなど） |
| `shop.csv` | 店舗・支払い方法ごとの還元率マスタ |
| `aff.csv` | 支払方法名とリンク URL の対応表 |
| `icons/` | ホーム画面アイコンなど |

サーバーサイドの処理は一切なく、GitHub Pages のような静的ホスティングにファイルを置くだけで動作します。`app.js` が起動時に `fetch()` で `shop.csv` と `aff.csv` を読み込み、ブラウザ上（クライアントサイド）だけで検索・計算・並べ替えを行っています（`app.js:314-356`）。

## 2. PWA（Progressive Web App）とは

PWA は、通常の Web サイトに以下の要素を追加することで、ネイティブアプリに近い体験（オフライン動作・ホーム画面への追加・スタンドアロン表示など）を提供する仕組みです。特別なアプリストアや専用ランタイムは不要で、ブラウザの標準機能だけで実現されます。

PWA を構成する主要な要素は次の 2 つです。

1. **Web App Manifest**（`manifest.webmanifest`）— アプリの「名刺」。アプリ名・アイコン・起動時の表示形式などをブラウザに伝えます。
2. **Service Worker**（`sw.js`）— ブラウザとネットワークの間に立つプロキシ的な JavaScript。オフラインキャッシュや通信の制御を担当します。

この 2 つがあることで、ブラウザは「これはインストール可能な PWA だ」と認識し、Android や PC の Chrome では「ホーム画面に追加 / インストール」の導線を表示するようになります。

### 2.1 Web App Manifest の中身

`manifest.webmanifest` (`manifest.webmanifest:1-32`) では、次のように定義しています。

- `start_url: "./"` — ホーム画面から起動したときに開く URL。
- `display: "standalone"` — ブラウザの URL バーやタブを非表示にし、ネイティブアプリのような見た目で起動する指定。
- `theme_color` / `background_color` — ステータスバーや起動画面の色。
- `icons` — ホーム画面アイコンや起動画面に使う画像（SVG・192px・512px の PNG）。

`index.html` 側でも `<link rel="manifest" ...>` や `apple-mobile-web-app-capable` などの `<meta>` タグ (`index.html:9-14`) を使い、Android/Chrome 系だけでなく iOS Safari の「ホーム画面に追加」にも対応しています。

## 3. なぜオフラインで動くのか — Service Worker の仕組み

オフライン対応の核心は `sw.js` です。Service Worker は、タブとは別に**バックグラウンドで動く JavaScript**で、ページが発行するすべてのネットワークリクエストを横取り（インターセプト）できます。一度登録されればページを閉じても常駐し、ブラウザと実際のネットワークの「間」に入ることでオフライン動作を可能にします。

### 3.1 登録

`app.js` の `init()` 内で、`serviceWorker` API が使えるブラウザであれば Service Worker を登録します。

```js
if ("serviceWorker" in navigator) {
  await navigator.serviceWorker.register("sw.js");
}
```
（`app.js:348-355`）

これは初回アクセス時に実行され、以降はブラウザがバックグラウンドで `sw.js` を管理します。

### 3.2 インストール時にアプリ本体を丸ごとキャッシュする

`sw.js` は `install` イベントで、アプリ動作に必要なファイル一式（アプリシェル）を `Cache Storage` に保存します。

```js
const APP_SHELL = [
  "./", "index.html", "styles.css", "app.js",
  "shop.csv", "aff.csv", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});
```
（`sw.js:4-23`）

`Cache Storage` はブラウザが提供する永続ストレージで、HTTP レスポンス（HTML・CSS・JS・CSV・画像など）をキーバリュー的に保存できます。ここに HTML・CSS・JS だけでなく `shop.csv` / `aff.csv`（還元率データそのもの）まで含めているのがポイントで、これによって**アプリのロジックだけでなく検索対象データまで**端末内に持てるようになっています。

### 3.3 リクエストの横取りと「ネットワーク優先＋キャッシュ フォールバック」

`fetch` イベントで、ページからのすべての GET リクエストを Service Worker が横取りします。

```js
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse?.ok && sameOrigin) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // ネットワーク失敗時はキャッシュへフォールバック

      return cachedResponse || networkFetch; // キャッシュがあれば即座に返す
    }),
  );
});
```
（`sw.js:37-61`、要約）

この実装は次のような挙動になります。

- **キャッシュに一致するレスポンスがあれば、それを即座に返しつつ**、裏で最新版をネットワークから取得して次回用にキャッシュを更新する（stale-while-revalidate に近い挙動）。
- **キャッシュがまだ無ければ**、ネットワーク取得を待って結果を返す。取得できたレスポンスは同一オリジンかつ成功時のみキャッシュに保存する。
- **ネットワークが完全に切断されている（オフライン）場合**、`fetch()` は失敗（reject）するので `.catch(() => cachedResponse)` によりキャッシュ済みレスポンスにフォールバックする。

つまり、一度アクセスしてキャッシュが作られていれば、機内モードなど完全にオフラインの状態でも `index.html` / `app.js` / `shop.csv` などすべてがキャッシュから返され、アプリは通常通り起動・動作します。データの取得先が `fetch("shop.csv")` というただの相対パスへのリクエストであるため（`app.js:317-318`）、アプリ側のコードはオンライン／オフラインを意識する必要がなく、Service Worker 層で透過的に解決されます。

### 3.4 キャッシュの更新管理

`CACHE_NAME`（例: `pwa-cost-v3`）をバージョン文字列として使い、`activate` イベントで**古いバージョンのキャッシュだけを削除**します。

```js
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()),
  );
});
```
（`sw.js:25-35`）

新しいコードや `shop.csv` のデータを配布したいときは `CACHE_NAME` の値を変更するだけで、ブラウザに新しい Service Worker として認識させ、旧キャッシュを破棄して新しいアプリシェルに入れ替えられます（README にも記載: `README.md:39`）。`self.skipWaiting()` と `self.clients.claim()` は、新しい Service Worker をユーザーがタブを閉じ直さなくても即座に有効化するための処理です。

このように、外部通信が必要なのは「初回に `shop.csv` / `aff.csv` / アプリ本体を取得するとき」だけで、それ以降の全操作（検索・計算・表示・アフィリエイトリンクの解決）はネットワークなしで完結します。

## 4. まとめ

- **PWA** とは、Web App Manifest と Service Worker という 2 つの標準技術を使って、Web サイトをインストール可能かつオフライン動作可能にする仕組み。
- このアプリは Service Worker が `install` 時にアプリ一式（コードとデータ CSV）を `Cache Storage` に保存し、`fetch` イベントでリクエストを横取りしてネットワーク失敗時にキャッシュへフォールバックすることでオフライン動作を実現している。
- サーバーサイド API に依存しないクライアント完結の設計になっているため、初回読み込み以降はネットワークが一切不要。
