# 還元額サーチ

GitHub Pages で公開できる、オフライン対応のシンプルな PWA です。

## 使い方

1. 「ショップ名検索（カナ）」に店名や読みを入力します。
2. 「値段（円）」に支払金額を入力します。
3. `shop.csv` の `検索用` が部分一致する支払い方法と、常に表示される `ALL` の支払い方法が、ポイント還元額の大きい順に表示されます。

## 計算式

CSV の `還元率` と `切り捨て` は `%` として扱っています。

```text
還元額 =
  入力金額 * 還元率 / 100
  + floor(入力金額 / 切り捨て単位) * 100 * 切り捨て / 100
```

## GitHub Pages で公開する

このリポジトリを GitHub に push したあと、GitHub のリポジトリ画面で:

1. **Settings** を開く
2. **Pages** を開く
3. **Build and deployment** の Source を **Deploy from a branch** にする
4. Branch を `main`（または利用中のブランチ）/ `/ (root)` に設定する
5. 保存する

数分後に表示される GitHub Pages の URL へアクセスできます。

## オフライン対応

初回アクセス時に Service Worker が `index.html`、CSS、JavaScript、`shop.csv`、アイコンをキャッシュします。  
一度読み込んだ後は、通信がない状態でも利用できます。

`shop.csv` やアプリを更新した場合は、`sw.js` の `CACHE_NAME` を変更すると、ブラウザが新しいキャッシュに更新しやすくなります。
