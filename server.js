const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// BABYDOGE reward settings
const MIN_WITHDRAWAL = 10000000;
const TASK_REWARD = 300000;
const TOKEN_NAME = 'BABYDOGE';

// =====================================================
// DATABASE MIGRATION & SCHEMA FIXES
// =====================================================
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255),
                binance_id VARCHAR(255),
                wallet VARCHAR(255),
                amount NUMERIC NOT NULL,
                type VARCHAR(50) DEFAULT 'Binance',
                token_type VARCHAR(50) DEFAULT 'BABYDOGE',
                total_deduct NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            ALTER TABLE withdrawals
            ADD COLUMN IF NOT EXISTS user_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS binance_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS wallet VARCHAR(255),
            ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'Binance',
            ADD COLUMN IF NOT EXISTS token_type VARCHAR(50) DEFAULT 'BABYDOGE',
            ADD COLUMN IF NOT EXISTS total_deduct NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

            ALTER TABLE withdrawals ALTER COLUMN user_id DROP NOT NULL;
            ALTER TABLE withdrawals ALTER COLUMN binance_id DROP NOT NULL;
            ALTER TABLE withdrawals ALTER COLUMN wallet DROP NOT NULL;
            ALTER TABLE withdrawals ALTER COLUMN type DROP NOT NULL;
            ALTER TABLE withdrawals ALTER COLUMN total_deduct DROP NOT NULL;
        `);

        console.log('SUCCESS: Database schema fully active and verified!');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
};
initDb();

// =====================================================
// ROOT
// =====================================================
app.get('/', (req, res) => {
    res.json({ status: 'Active', app: 'BABYDOGE Earn Backend' });
});

// =====================================================
// 1. ADS & ENERGY RECHARGE HANDLERS
// =====================================================
const rechargeHandler = (req, res) => {
    const { userId, energyAmount } = req.body;
    const addedEnergy = energyAmount || 300;
    console.log(`[ADS REWARD] Refill request received for: ${userId || 'User'} | Added: ${addedEnergy}`);
    res.json({ success: true, message: 'Energy successfully recharged!', energyAdded: addedEnergy });
};
app.post('/api/recharge-energy', rechargeHandler);
app.post('/api/bonk/recharge-energy', rechargeHandler);

// =====================================================
// 2. SUBMIT WITHDRAWAL HANDLER
// =====================================================
const withdrawHandler = async (req, res) => {
    const { binanceId, amount, userId, wallet, type, tokenType, totalDeduct } = req.body;

    if (!binanceId || !amount || Number(amount) < MIN_WITHDRAWAL) {
        return res.status(400).json({
            success: false,
            message: `Minimum withdrawal is ${MIN_WITHDRAWAL.toLocaleString()} ${TOKEN_NAME}`
        });
    }

    const id = Date.now().toString();
    const finalUserId = userId || req.body.user_id || 'N/A';
    const finalWallet = wallet || req.body.wallet || binanceId;
    const finalType = type || req.body.type || 'Binance';
    const finalTokenType = tokenType || req.body.token_type || TOKEN_NAME;
    const finalDeduct = totalDeduct || req.body.total_deduct || amount;

    try {
        const query = `
            INSERT INTO withdrawals
            (id, user_id, binance_id, wallet, amount, type, token_type, total_deduct, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;

        await pool.query(query, [
            id, finalUserId, binanceId, finalWallet, amount,
            finalType, finalTokenType, finalDeduct, 'Pending'
        ]);

        console.log(`[WITHDRAWAL SUCCESS] Token: ${finalTokenType} | Binance ID: ${binanceId} | Amount: ${amount}`);
        res.json({ success: true, message: 'Request received' });
    } catch (err) {
        console.error('Database Save Error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error', error: err.message });
    }
};

app.post('/api/withdraw', withdrawHandler);
app.post('/api/bonk/withdraw', withdrawHandler);

// =====================================================
// 3. GET BONK/BABYDOGE WITHDRAWALS
// =====================================================
app.get('/api/bonk/withdrawals', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, user_id AS "userId", binance_id AS "binanceId", wallet,
                   amount, type, token_type AS "tokenType", status,
                   created_at AS "createdAt"
            FROM withdrawals
            WHERE UPPER(token_type) = 'BABYDOGE'
               OR UPPER(token_type) = 'BONK'
               OR token_type IS NULL
            ORDER BY created_at DESC;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Database Fetch Error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error', error: err.message });
    }
});

// =====================================================
// 4. GET ALL WITHDRAWALS
// =====================================================
app.get('/api/withdrawals', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, user_id AS "userId", binance_id AS "binanceId", wallet,
                   amount, type, token_type AS "tokenType", status,
                   created_at AS "createdAt"
            FROM withdrawals
            ORDER BY created_at DESC;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Database Fetch Error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error', error: err.message });
    }
});

// =====================================================
// 5. UPDATE WITHDRAWAL STATUS HANDLER
// =====================================================
const updateStatusHandler = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    try {
        const result = await pool.query(
            `UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *;`,
            [status, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (err) {
        console.error('Database Update Error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error', error: err.message });
    }
};
app.put('/api/withdrawals/:id', updateStatusHandler);
app.put('/api/bonk/withdrawals/:id', updateStatusHandler);

// =====================================================
// 7. WEEKLY CONTEST
// =====================================================
const CONTEST_ADMIN_PASSWORD = process.env.CONTEST_ADMIN_PASSWORD;
const contestTableSql = `
CREATE TABLE IF NOT EXISTS bonk_weekly_contest (
    user_id VARCHAR(255) PRIMARY KEY,
    binance_id VARCHAR(255) NOT NULL,
    total_ads INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
(async () => {
    try { await pool.query(contestTableSql); console.log('SUCCESS: Weekly contest database ready!'); }
    catch (err) { console.error('Contest database initialization error:', err.message); }
})();

app.get('/api/bonk/contest/stats/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT binance_id AS "binanceId", total_ads AS "totalAds" FROM bonk_weekly_contest WHERE user_id = $1',
            [String(req.params.userId).trim()]
        );
        const row = result.rows[0] || {};
        res.json({ success: true, binanceId: row.binanceId || null, totalAds: Number(row.totalAds || 0) });
    } catch (err) { res.status(500).json({ success: false, message: 'Database Error' }); }
});

app.post('/api/bonk/contest/ad', async (req, res) => {
    const userId = String(req.body.userId || '').trim();
    const binanceId = String(req.body.binanceId || '').trim();
    if (!userId || !/^[0-9]{5,20}$/.test(binanceId)) {
        return res.status(400).json({ success: false, message: 'Valid user ID and Binance UID are required.' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO bonk_weekly_contest (user_id, binance_id, total_ads)
            VALUES ($1, $2, 1)
            ON CONFLICT (user_id)
            DO UPDATE SET binance_id = EXCLUDED.binance_id,
                          total_ads = bonk_weekly_contest.total_ads + 1,
                          updated_at = CURRENT_TIMESTAMP
            RETURNING binance_id AS "binanceId", total_ads AS "totalAds";
        `, [userId, binanceId]);
        res.json({ success: true, ...result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: 'Database Error' }); }
});

app.get('/api/bonk/contest/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT binance_id AS "binanceId", total_ads AS "totalAds",
                   RANK() OVER (ORDER BY total_ads DESC, updated_at ASC) AS rank
            FROM bonk_weekly_contest
            ORDER BY total_ads DESC, updated_at ASC;
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, message: 'Database Error' }); }
});

app.post('/api/bonk/contest/reset', async (req, res) => {
    if (!CONTEST_ADMIN_PASSWORD) return res.status(503).json({ success: false, message: 'Admin password is not configured on the server.' });
    if (String(req.body.password || '') !== CONTEST_ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Invalid admin password.' });
    try {
        await pool.query('UPDATE bonk_weekly_contest SET total_ads = 0, updated_at = CURRENT_TIMESTAMP');
        res.json({ success: true, message: 'Leaderboard reset successfully.' });
    } catch (err) { res.status(500).json({ success: false, message: 'Database Error' }); }
});

// =====================================================
// 8. NFT MEMBERSHIP
// =====================================================
const NFT_ADMIN_PASSWORD = process.env.CONTEST_ADMIN_PASSWORD;
const nftTableSql = `
CREATE TABLE IF NOT EXISTS bonk_nfts (
    user_id VARCHAR(255) PRIMARY KEY,
    nft_id VARCHAR(32) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Inactive',
    activated_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
(async () => {
    try { await pool.query(nftTableSql); console.log('SUCCESS: NFT database ready!'); }
    catch (err) { console.error('NFT database initialization error:', err.message); }
})();

function createNftId() {
    return `NFT-${Math.floor(10000 + Math.random() * 90000)}`;
}

app.get('/api/bonk/nft/status/:userId', async (req, res) => {
    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ success: false, message: 'User ID is required.' });
    try {
        let result = await pool.query(
            'SELECT nft_id AS "nftId", status, expires_at AS "expiresAt" FROM bonk_nfts WHERE user_id = $1',
            [userId]
        );
        if (result.rowCount === 0) {
            let nftId;
            for (let attempt = 0; attempt < 5; attempt++) {
                nftId = createNftId();
                try {
                    await pool.query('INSERT INTO bonk_nfts (user_id, nft_id) VALUES ($1, $2)', [userId, nftId]);
                    break;
                } catch (err) {
                    if (err.code !== '23505' || attempt === 4) throw err;
                }
            }
            result = await pool.query(
                'SELECT nft_id AS "nftId", status, expires_at AS "expiresAt" FROM bonk_nfts WHERE user_id = $1',
                [userId]
            );
        }
        const row = result.rows[0];
        const expired = row.status === 'Active' && row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now();
        if (expired) {
            await pool.query("UPDATE bonk_nfts SET status = 'Inactive', activated_at = NULL, expires_at = NULL WHERE user_id = $1", [userId]);
            return res.json({ success: true, nftId: row.nftId, status: 'Inactive', active: false, expiresAt: null });
        }
        res.json({ success: true, nftId: row.nftId, status: row.status, active: row.status === 'Active', expiresAt: row.expiresAt || null });
    } catch (err) {
        console.error('NFT status error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
});

app.post('/api/bonk/nft/activate', async (req, res) => {
    const nftId = String(req.body.nftId || '').trim().toUpperCase();
    const password = String(req.body.password || '');
    if (!NFT_ADMIN_PASSWORD) return res.status(503).json({ success: false, message: 'Admin password is not configured on the server.' });
    if (password !== NFT_ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Invalid admin password.' });
    if (!/^NFT-[A-Z0-9]{5,20}$/.test(nftId)) return res.status(400).json({ success: false, message: 'Invalid NFT ID.' });
    try {
        const result = await pool.query(`
            UPDATE bonk_nfts
            SET status = 'Active', activated_at = CURRENT_TIMESTAMP,
                expires_at = CURRENT_TIMESTAMP + INTERVAL '1 month'
            WHERE nft_id = $1
            RETURNING nft_id AS "nftId", status, expires_at AS "expiresAt";
        `, [nftId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'NFT ID not found.' });
        res.json({ success: true, ...result.rows[0], message: 'NFT activated for 1 month.' });
    } catch (err) {
        console.error('NFT activation error:', err.message);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
});

// =====================================================
// 9. NFT ADMIN PANEL
// =====================================================
app.get('/admin', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BABYDOGE NFT Admin Panel</title>
<style>
body{font-family:Arial,sans-serif;background:#111;color:#fff;max-width:520px;margin:40px auto;padding:20px}
.card{background:#1d1d1d;padding:24px;border-radius:16px;box-shadow:0 0 20px #000}
h1{color:#ffcc00;font-size:25px}label{display:block;margin-top:16px;margin-bottom:6px}
input,button{width:100%;box-sizing:border-box;padding:13px;border-radius:9px;border:1px solid #555;font-size:16px}
input{background:#292929;color:#fff}button{margin-top:20px;background:#ffcc00;color:#111;border:0;font-weight:bold;cursor:pointer}
#result{margin-top:18px;white-space:pre-wrap;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<h1>🟡 BABYDOGE NFT Admin Panel</h1>
<p>Activate a user's NFT for 1 month.</p>
<form id="activateForm">
<label for="nftId">NFT ID</label>
<input id="nftId" name="nftId" placeholder="NFT-99599" required>
<label for="password">Admin Password</label>
<input id="password" name="password" type="password" placeholder="Enter admin password" required>
<button type="submit">Activate NFT</button>
</form>
<div id="result"></div>
</div>
<script>
document.getElementById('activateForm').addEventListener('submit', async function(event){
    event.preventDefault();
    const resultBox = document.getElementById('result');
    resultBox.textContent = 'Processing...';
    const nftId = document.getElementById('nftId').value.trim();
    const password = document.getElementById('password').value;
    try {
        const response = await fetch('/api/bonk/nft/activate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
            body: JSON.stringify({nftId, password})
        });
        const data = await response.json();
        resultBox.textContent = data.success
            ? 'Success: ' + data.message + '\nNFT: ' + data.nftId + '\nExpires: ' + (data.expiresAt || 'N/A')
            : 'Error: ' + (data.message || 'Request failed');
    } catch (error) {
        resultBox.textContent = 'Network error: ' + error.message;
    }
});
</script>
</body>
</html>`);
});

// =====================================================
// SERVER START
// =====================================================
app.listen(PORT, () => {
    console.log(`BABYDOGE Earn backend running on port ${PORT}`);
    console.log(`Minimum withdrawal: ${MIN_WITHDRAWAL} ${TOKEN_NAME}`);
    console.log(`Task reward: ${TASK_REWARD} ${TOKEN_NAME}`);
});
