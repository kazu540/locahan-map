# ロケハン地図

撮影のロケハン用に、気になった場所と「光の情報（太陽の位置など）」を記録して、あとから地図やタグで見返すためのiPhone向けWebアプリです。

- データはすべてiPhoneの中に保存されます（サーバーやログインはありません）。
- 費用はかかりません（GitHub Pagesで公開しています）。

> いまは **段階6** です。記録を地図と一覧で見返し、タグで絞り込み、日時を変えて光をシミュレーションできます。
> 使い方・バックアップ・困ったときの対処は、完成時にこのファイルへ詳しく書きます。

## 使っているもの（ライセンス）

- [SunCalc](https://github.com/mourner/suncalc)（太陽の位置の計算）— BSD 2-Clause License。`vendor/suncalc.js` に同梱しています。
- [Leaflet](https://leafletjs.com/)（地図の表示）— BSD 2-Clause License。`vendor/leaflet/` に同梱しています。
- 地図データ：© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（ODbL）
- 天気：[Open-Meteo](https://open-meteo.com/)（無料・登録不要。CC BY 4.0）。天気を取得するときだけ、記録した場所の緯度・経度と日付をOpen-Meteoに送ります。写真やメモは送りません。
