(() => {
  'use strict';

  const CELL = 30; // 1マス=30px（CSSピクセル）
  const COLS = 10;
  const ROWS = 20;
  const WIDTH = COLS * CELL;
  const HEIGHT = ROWS * CELL;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;

  // 画像関連
  const IMAGE_DIR = 'images/';
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
  /** @type {HTMLImageElement[]} */
  let loadedImages = [];

  // テトリス関連定数
  const PAD = 4; // セル内の余白（描画用）
  const DROP_INTERVAL_MS = 800; // 重力落下の間隔
  const SOFT_DROP_INTERVAL_MS = 50; // ソフトドロップ時の間隔
  let lastDropAt = 0;
  let softDropping = false;
  let running = false; // 初期は停止（スタート画面）
  let started = false;

  // デバイスピクセル比に合わせてキャンバスをスケーリング（にじみ防止）
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  ctx.scale(dpr, dpr);
  if (nextCanvas && nextCtx) {
    nextCanvas.width = nextCanvas.width * dpr;
    nextCanvas.height = nextCanvas.height * dpr;
    nextCtx.scale(dpr, dpr);
  }

  // 背景グリッドを描画
  function drawGrid() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // 背景グラデーション
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0b0e2a');
    g.addColorStop(1, '#0a0d24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 枠（淡いピンク系）
    ctx.strokeStyle = 'rgba(244,114,182,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

    // グリッド線
    ctx.strokeStyle = 'rgba(244,114,182,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, HEIGHT);
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(WIDTH, y * CELL + 0.5);
    }
    ctx.stroke();
  }

  function randInt(min, max) { // [min, max]
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 1マスの中心に画像 or 四角（アウトライン）を描く（テクスチャimgを使用）
  function drawCell(col, row, img) {
    const x = col * CELL;
    const y = row * CELL;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const r = (CELL / 2) - PAD;

    ctx.save();
    // セルの軽いハイライト
    const cellGrad = ctx.createLinearGradient(x, y, x, y + CELL);
    cellGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
    cellGrad.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = cellGrad;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);

    const innerSize = r * 2;
    if (img) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(innerSize / iw, innerSize / ih);
      const dw = Math.max(1, Math.floor(iw * scale));
      const dh = Math.max(1, Math.floor(ih * scale));
      const dx = Math.floor(cx - dw / 2);
      const dy = Math.floor(cy - dh / 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      // 画像がない場合はアウトライン四角
      ctx.strokeStyle = 'rgba(230,232,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  // ボード配列（null か {img}）
  /** @type {(null | {img: HTMLImageElement|null})[][]} */
  let board = [];

  function resetBoard() {
    board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
  }

  // テトリミノ定義（回転形は都度回す）
  const TETROMINOS = {
    I: [
      [0,0,0,0],
      [1,1,1,1],
      [0,0,0,0],
      [0,0,0,0],
    ],
    O: [
      [1,1],
      [1,1],
    ],
    T: [
      [0,1,0],
      [1,1,1],
      [0,0,0],
    ],
    L: [
      [0,0,1],
      [1,1,1],
      [0,0,0],
    ],
    J: [
      [1,0,0],
      [1,1,1],
      [0,0,0],
    ],
    S: [
      [0,1,1],
      [1,1,0],
      [0,0,0],
    ],
    Z: [
      [1,1,0],
      [0,1,1],
      [0,0,0],
    ],
  };

  function rotateMatrix(mat) {
    const h = mat.length, w = mat[0].length;
    const res = Array.from({ length: w }, () => Array(h).fill(0));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        res[x][h - 1 - y] = mat[y][x];
      }
    }
    return res;
  }

  function getRandomTetromino() {
    const keys = Object.keys(TETROMINOS);
    const type = keys[randInt(0, keys.length - 1)];
    const shape = TETROMINOS[type].map(row => row.slice());
    const img = loadedImages.length > 0 ? pick(loadedImages) : null;
    const piece = {
      type,
      shape,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: -getTopPadding(shape), // 画面外から出現
      img,
    };
    return piece;
  }

  function getTopPadding(shape) {
    // 上部の空行数（スポーン時の見栄え）
    let pad = 0;
    for (let y = 0; y < shape.length; y++) {
      if (shape[y].every(v => v === 0)) pad++;
      else break;
    }
    return pad;
  }

  /** @type {{type:string,shape:number[][],x:number,y:number,img:HTMLImageElement|null}|null} */
  let current = null;
  /** @type {{type:string,shape:number[][],x:number,y:number,img:HTMLImageElement|null}|null} */
  let nextPiece = null;

  function collides(shape, offX, offY) {
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const nx = offX + x;
        const ny = offY + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && board[ny][nx]) return true;
      }
    }
    return false;
  }

  function lockPiece() {
    if (!current) return;
    const { shape, x: px, y: py, img } = current;
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const nx = px + x;
        const ny = py + y;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
          board[ny][nx] = { img };
        }
      }
    }
    // ライン判定（アニメーション対応）
    const rows = getFullRows();
    if (rows.length > 0) {
      // ピースは一旦消す（固定のみ残す）
      current = null;
      startLineClear(rows);
      showQuote(rows.length);
    } else {
      // 次のピースへ
      current = nextPiece || getRandomTetromino();
      nextPiece = getRandomTetromino();
      renderNext();
      if (collides(current.shape, current.x, current.y)) {
        running = false;
        showGameOverOverlay(true);
      }
    }
  }

  function getFullRows() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (board[y].every(cell => cell)) rows.push(y);
    }
    return rows;
  }

  function clearRows(rows) {
    // インデックスシフトを避けるため降順で削除
    const sortedDesc = rows.slice().sort((a, b) => b - a);
    for (const y of sortedDesc) {
      board.splice(y, 1);
      board.unshift(Array.from({ length: COLS }, () => null));
    }
  }

  function hardDrop() {
    if (!current) return;
    while (!collides(current.shape, current.x, current.y + 1)) {
      current.y++;
    }
    lockPiece();
  }

  function tryMove(dx, dy) {
    if (!current) return;
    const nx = current.x + dx;
    const ny = current.y + dy;
    if (!collides(current.shape, nx, ny)) {
      current.x = nx;
      current.y = ny;
    } else if (dy === 1) {
      // 下方向に動けなければロック
      lockPiece();
    }
  }

  function tryRotate() {
    if (!current) return;
    const rotated = rotateMatrix(current.shape);
    // 壁蹴り（簡易）: 左右に1マスずらしてみる
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      const nx = current.x + k;
      const ny = current.y;
      if (!collides(rotated, nx, ny)) {
        current.shape = rotated;
        current.x = nx;
        return;
      }
    }
  }

  function render() {
    drawGrid();
    // 固定ブロック
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = board[y][x];
        if (cell) drawCell(x, y, cell.img);
      }
    }
    // 操作中のピース
    if (current) {
      for (let y = 0; y < current.shape.length; y++) {
        for (let x = 0; x < current.shape[y].length; x++) {
          if (!current.shape[y][x]) continue;
          const gx = current.x + x;
          const gy = current.y + y;
          if (gy >= 0) drawCell(gx, gy, current.img);
        }
      }
    }
    // パーティクル描画
    if (lineClearEffect.active) {
      renderParticles();
    }
  }

  // ネクストピースの境界を求める
  function computeBoundingBox(shape) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }

  // ネクストピースを専用キャンバスに描画
  function renderNext() {
    if (!nextCtx || !nextCanvas) return;
    const W = nextCanvas.width / dpr;
    const H = nextCanvas.height / dpr;
    nextCtx.clearRect(0, 0, W, H);

    // 軽い背景
    const g = nextCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(255,255,255,0.00)');
    nextCtx.fillStyle = g;
    nextCtx.fillRect(0, 0, W, H);

    if (!nextPiece) return;
    const cell = 24;
    const pad = 3;
    const { minX, minY, maxX, maxY } = computeBoundingBox(nextPiece.shape);
    const pieceW = (maxX - minX + 1) * cell;
    const pieceH = (maxY - minY + 1) * cell;
    const startX = Math.floor((W - pieceW) / 2);
    const startY = Math.floor((H - pieceH) / 2);

    for (let y = 0; y < nextPiece.shape.length; y++) {
      for (let x = 0; x < nextPiece.shape[y].length; x++) {
        if (!nextPiece.shape[y][x]) continue;
        const gx = startX + (x - minX) * cell;
        const gy = startY + (y - minY) * cell;

        nextCtx.save();
        const cellGrad = nextCtx.createLinearGradient(gx, gy, gx, gy + cell);
        cellGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
        cellGrad.addColorStop(1, 'rgba(255,255,255,0.00)');
        nextCtx.fillStyle = cellGrad;
        nextCtx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);

        const cx = gx + cell / 2;
        const cy = gy + cell / 2;
        const r = (cell / 2) - pad;
        const img = nextPiece.img;
        const innerSize = r * 2;
        if (img) {
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          const scale = Math.min(innerSize / iw, innerSize / ih);
          const dw = Math.max(1, Math.floor(iw * scale));
          const dh = Math.max(1, Math.floor(ih * scale));
          const dx = Math.floor(cx - dw / 2);
          const dy = Math.floor(cy - dh / 2);
          nextCtx.imageSmoothingEnabled = true;
          nextCtx.imageSmoothingQuality = 'high';
          nextCtx.drawImage(img, dx, dy, dw, dh);
        } else {
          nextCtx.strokeStyle = 'rgba(236,72,153,0.9)';
          nextCtx.lineWidth = 2;
          nextCtx.beginPath();
          nextCtx.rect(cx - r, cy - r, r * 2, r * 2);
          nextCtx.closePath();
          nextCtx.stroke();
        }
        nextCtx.restore();
      }
    }
  }

  function gameLoop(ts) {
    const interval = softDropping ? SOFT_DROP_INTERVAL_MS : DROP_INTERVAL_MS;
    if (!lastDropAt) lastDropAt = ts;
    // セーフティ: 実行中かつピースが無い、演出中でもない場合は新規スポーン
    if (running && !current && !lineClearEffect.active) {
      current = nextPiece || getRandomTetromino();
      nextPiece = getRandomTetromino();
      renderNext();
      lastDropAt = ts;
    }
    if (running) {
      const elapsed = ts - lastDropAt;
      if (elapsed >= interval) {
        tryMove(0, 1);
        lastDropAt = ts;
      }
    }
    // パーティクル更新
    if (lineClearEffect.active) {
      updateParticles(ts);
    }
    render();
    requestAnimationFrame(gameLoop);
  }

  // 画像ディレクトリを探索してプリロード
  async function discoverAndPreloadImages() {
    const loadOne = (src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // 個別エラーは無視
      img.src = src;
    });

    // 1) Netlify 等での本番運用: manifest.json を優先
    try {
      const res = await fetch(IMAGE_DIR + 'manifest.json', { cache: 'no-cache' });
      if (res.ok) {
        const list = await res.json(); // ["file1.png", ...]
        if (Array.isArray(list) && list.length > 0) {
          const paths = list.map(name => (name.startsWith('http') ? name : IMAGE_DIR + name));
          const results = await Promise.all(paths.map(loadOne));
          loadedImages = results.filter(Boolean);
          if (loadedImages.length > 0) return;
        }
      }
    } catch (_ignore) {
      // manifest が無い/失敗 → フォールバックへ
    }

    // 2) ローカル開発向けフォールバック: ディレクトリ一覧をパース
    try {
      const res = await fetch(IMAGE_DIR, { cache: 'no-cache' });
      if (!res.ok) throw new Error('failed to fetch images directory');
      const html = await res.text();
      const dom = new DOMParser().parseFromString(html, 'text/html');
      const links = Array.from(dom.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(href => !!href)
        .map(href => href.trim());
      const imagePaths = links
        .filter(href => !href.startsWith('?'))
        .filter(href => !href.startsWith('../'))
        .filter(href => IMAGE_EXTS.some(ext => href.toLowerCase().endsWith(ext)))
        .map(href => (href.startsWith('http') ? href : IMAGE_DIR + href));

      const results = await Promise.all(imagePaths.map(loadOne));
      loadedImages = results.filter(Boolean);
    } catch (_e) {
      loadedImages = [];
    }
  }

  async function init() {
    resetBoard();
    await discoverAndPreloadImages();
    current = getRandomTetromino();
    nextPiece = getRandomTetromino();
    render();
    renderNext();
    requestAnimationFrame(gameLoop);
    // リロード時も必ずスタート画面から
    running = false;
    started = false;
    showStartOverlay(true);
    showGameOverOverlay(false);
  }
  // 初期化
  init();

  // 入力（キーボード）
  window.addEventListener('keydown', (e) => {
    // スタート前は Space/Enter/クリックで開始できるようにする（任意）
    if (!running) {
      if (!started && (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp')) {
        startGame();
        // 初回キーは開始専用として消費
        return;
      }
      // まだ走っていなければ他の入力は無視
      if (!running) return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      tryMove(-1, 0);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      tryMove(1, 0);
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      softDropping = true;
      tryMove(0, 1);
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      hardDrop();
    } else if (e.code === 'Space') {
      e.preventDefault();
      tryRotate();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      // リスタート
      resetBoard();
      current = nextPiece || getRandomTetromino();
      nextPiece = getRandomTetromino();
      renderNext();
      hideStartOverlay();
      showGameOverOverlay(false);
      running = true;
      started = true;
      lastDropAt = 0;
      softDropping = false;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowDown') softDropping = false;
  });

  // ボタン: リスタート
  const btnRestart = document.getElementById('btn-restart');
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      resetBoard();
      current = nextPiece || getRandomTetromino();
      nextPiece = getRandomTetromino();
      renderNext();
      hideStartOverlay();
      showGameOverOverlay(false);
      running = true;
      started = true;
      // タイマーと状態をリセット
      lastDropAt = 0;
      softDropping = false;
    });
  }

  // スタート/ゲームオーバー オーバーレイ制御
  const overlayStart = document.getElementById('overlay-start');
  const overlayGameOver = document.getElementById('overlay-gameover');
  const btnStart = document.getElementById('btn-start');
  const btnRestart2 = document.getElementById('btn-restart2');

  function showStartOverlay(visible) {
    if (!overlayStart) return;
    overlayStart.classList.toggle('visible', visible);
    overlayStart.setAttribute('aria-hidden', String(!visible));
  }
  function hideStartOverlay() { showStartOverlay(false); }
  function showGameOverOverlay(visible) {
    if (!overlayGameOver) return;
    overlayGameOver.classList.toggle('visible', visible);
    overlayGameOver.setAttribute('aria-hidden', String(!visible));
  }
  function startGame() {
    hideStartOverlay();
    showGameOverOverlay(false);
    resetBoard();
    current = nextPiece || getRandomTetromino();
    nextPiece = getRandomTetromino();
    renderNext();
    running = true;
    started = true;
    // タイマーと状態をリセット
    lastDropAt = 0;
    softDropping = false;
  }
  if (btnStart) btnStart.addEventListener('click', startGame);
  if (btnRestart2) btnRestart2.addEventListener('click', startGame);

  // ライン消去パーティクルとセリフ
  const lineClearEffect = {
    active: false,
    endAt: 0,
    particles: [],
    rows: [],
    duration: 500, // ms
  };

  function startLineClear(rows) {
    // 停止
    running = false;
    lineClearEffect.active = true;
    lineClearEffect.endAt = performance.now() + lineClearEffect.duration;
    lineClearEffect.rows = rows.slice();
    lineClearEffect.particles = [];
    // クリア行の各セルからパーティクル生成
    const PARTICLES_PER_CELL = 10;
    for (const y of rows) {
      for (let x = 0; x < COLS; x++) {
        if (!board[y][x]) continue;
        const baseX = x * CELL + CELL / 2;
        const baseY = y * CELL + CELL / 2;
        for (let i = 0; i < PARTICLES_PER_CELL; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 40 + Math.random() * 120; // px/s
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed - 50; // 少し上に
          const life = 500 * (0.6 + Math.random() * 0.6); // ms
          lineClearEffect.particles.push({ x: baseX, y: baseY, vx, vy, life, age: 0 });
        }
      }
    }
  }

  function updateParticles(ts) {
    const now = ts;
    // 前フレームとの差分で更新
    if (!updateParticles.prev) updateParticles.prev = now;
    const dt = Math.min(64, now - updateParticles.prev); // clamp
    updateParticles.prev = now;

    const gravity = 400; // px/s^2
    const alphaFade = 0.003; // per ms

    lineClearEffect.particles.forEach(p => {
      const dtSec = dt / 1000;
      p.vy += gravity * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.age += dt;
    });
    // 期限
    if (now >= lineClearEffect.endAt) {
      lineClearEffect.active = false;
      updateParticles.prev = 0;
      // 実際に行削除（念のため現時点でフルラインを再計算して全て消す）
      const rowsNow = getFullRows();
      if (rowsNow.length > 0) clearRows(rowsNow);
      // 次のピースへ
      current = nextPiece || getRandomTetromino();
      nextPiece = getRandomTetromino();
      renderNext();
      // 再開 or ゲームオーバー
      if (collides(current.shape, current.x, current.y)) {
        running = false;
        current = null;
        showGameOverOverlay(true);
      } else {
        running = true;
      }
    }
  }

  function renderParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of lineClearEffect.particles) {
      const a = Math.max(0, 1 - p.age / lineClearEffect.duration);
      ctx.fillStyle = `rgba(244,114,182,${(0.6 * a).toFixed(3)})`;
      const size = Math.max(2, 2 + (1 - a) * 3);
      ctx.beginPath();
      ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.fill();
    }
    ctx.restore();
  }

  function showQuote(linesCleared) {
    const q1 = [
      'おじいちゃんは見てて！現代の忍びをなめんじゃないわよ！！',
      'あんた、私より活躍してるんじゃないわよ！ちょっと！目を覚ましなさいよ！！',
    ];
    const q2 = [
      '力を貸してくれ……風魔はオレ以外、やられた……！',
      'なぜ？主人公はね、助けてほしい時に助けに来るものなのよ！',
    ];
    const q3 = [
      '我らの目的はクリプトを集めて滅びの術で世界を滅ぼすことだけだ',
      '滅ぼした側は忘れても、滅ぼされた側は忘れんもんじゃ',
    ];
    const q4 = [
      '――狐白！貴様が、クリプトを……！',
    ];
    let pool = q1;
    if (linesCleared === 2) pool = q2;
    else if (linesCleared === 3) pool = q3;
    else if (linesCleared >= 4) pool = q4;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const el = document.getElementById('speech-bubble');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(showQuote._t);
    showQuote._t = window.setTimeout(() => {
      el.classList.remove('show');
    }, 1500);
  }
})();
