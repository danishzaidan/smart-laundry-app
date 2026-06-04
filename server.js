// Memanggil library yang sudah diinstal
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2'); // Sudah pakai mysql2 agar kebal putus
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors()); // Ini ngasih izin Web Dashboard buat narik data
app.use(express.json()); // Middleware agar server bisa membaca data JSON dari ESP32

// 1. Setup Koneksi ke Database Online (VERSI ANTI-TIDUR CLEVER CLOUD)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 4, // Batasi 4 agar tidak kena limit Clever Cloud
    queueLimit: 0,
    enableKeepAlive: true, // Paksa koneksi tetap bangun
    keepAliveInitialDelay: 10000 // Ping database setiap 10 detik
});

// 2. Tes Koneksi Database
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Gagal koneksi ke database online:', err.code);
    } else {
        console.log('✅ Berhasil terhubung ke database MySQL Clever Cloud!');
        connection.release(); // Lepaskan koneksi agar tidak menumpuk
    }
});

// --- SISTEM ROUTING HALAMAN WEB (URL) ---
// Memberitahu Express lokasi folder web kita
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/topup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'topup.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/simulate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'simulate.html'))); 

// --- ENDPOINT API BACKEND ---

// 3. Endpoint untuk menerima data dari ESP32 (Sensor Watt & Air)
app.post('/api/iot/log', (req, res) => {
    const { id_mesin, watt, flow_liter, status_mesin } = req.body;

    if (watt === undefined || flow_liter === undefined) {
        return res.status(400).json({ status: 'error', pesan: 'Data tidak lengkap!' });
    }

    const querySQL = "INSERT INTO tb_log_iot (id_mesin, watt, flow_liter, status_mesin) VALUES (?, ?, ?, ?)";
    const dataValues = [id_mesin || 'MESIN-01', watt, flow_liter, status_mesin || 'STANDBY'];

    db.query(querySQL, dataValues, (err, result) => {
        if (err) {
            console.error('❌ Gagal menyimpan log IoT:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gagal database' });
        }
        
        console.log(`📥 [DATA MASUK] Mesin: ${id_mesin || 'MESIN-01'} | Daya: ${watt}W | Air: ${flow_liter}L`);
        res.status(201).json({ 
            status: 'success', 
            pesan: 'Data sensor berhasil disimpan!',
            id_log: result.insertId 
        });
    });
});

// 4. Endpoint untuk mengambil data terbaru (Untuk Web Dashboard)
app.get('/api/iot/status', (req, res) => {
    const querySQL = "SELECT * FROM tb_log_iot ORDER BY waktu_catat DESC LIMIT 1";

    db.query(querySQL, (err, result) => {
        if (err) {
            console.error('❌ Gagal mengambil data:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gagal membaca database' });
        }

        if (result.length > 0) {
            res.status(200).json({ status: 'success', data: result[0] });
        } else {
            res.status(404).json({ status: 'error', pesan: 'Belum ada data mesin cuci' });
        }
    });
});

// 5. Endpoint untuk Registrasi User/Kartu Baru
app.post('/api/user/register', (req, res) => {
    const { rfid_uid, nama_user, info_tambahan, saldo } = req.body;

    if (!rfid_uid || !nama_user) {
        return res.status(400).json({ status: 'error', pesan: 'UID Kartu dan Nama tidak boleh kosong!' });
    }

    const querySQL = "INSERT INTO tb_user (rfid_uid, nama_user, info_tambahan, saldo) VALUES (?, ?, ?, ?)";
    const dataValues = [rfid_uid, nama_user, info_tambahan || '', saldo || 0];

    db.query(querySQL, dataValues, (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ status: 'error', pesan: 'Gagal! UID Kartu ini sudah terdaftar.' });
            }
            console.error('❌ Gagal registrasi user:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gagal menyimpan ke database' });
        }

        console.log(`👤 [USER BARU] Nama: ${nama_user} | UID: ${rfid_uid} | Saldo: Rp ${saldo}`);
        res.status(201).json({ status: 'success', pesan: 'User berhasil didaftarkan!' });
    });
});

// 6. Endpoint untuk Simulasi Tap Kartu RFID dengan Hitungan per Kg
app.post('/api/iot/tap', (req, res) => {
    const { rfid_uid, berat_kg } = req.body;
    const HARGA_PER_KG = 7000; // Tarif Rp 7.000 per kilo

    if (!rfid_uid) {
        return res.status(400).json({ status: 'ditolak', pesan: 'UID tidak terbaca' });
    }
    if (!berat_kg || berat_kg <= 0) {
        return res.status(400).json({ status: 'ditolak', pesan: 'Input berat tidak valid!' });
    }

    const BIAYA_CUCI = parseFloat(berat_kg) * HARGA_PER_KG;

    db.query("SELECT * FROM tb_user WHERE rfid_uid = ?", [rfid_uid], (err, results) => {
        if (err) {
            console.error('❌ Error cek kartu:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gangguan server' });
        }

        if (results.length === 0) {
            console.log(`🚫 [DITOLAK] Kartu ${rfid_uid} tidak terdaftar!`);
            return res.status(404).json({ status: 'ditolak', pesan: 'Kartu tidak terdaftar!' });
        }

        const user = results[0];

        if (user.saldo < BIAYA_CUCI) {
            console.log(`🚫 [DITOLAK] Saldo ${user.nama_user} kurang! Total Biaya: Rp ${BIAYA_CUCI} (Sisa Saldo: Rp ${user.saldo})`);
            return res.status(403).json({ status: 'ditolak', pesan: `Saldo kurang! Butuh Rp ${BIAYA_CUCI.toLocaleString('id-ID')}` });
        }

        const sisaSaldo = user.saldo - BIAYA_CUCI;
        
        db.query("UPDATE tb_user SET saldo = ? WHERE rfid_uid = ?", [sisaSaldo, rfid_uid], (errUpdate) => {
            if (errUpdate) {
                console.error('❌ Gagal potong saldo:', errUpdate);
                return res.status(500).json({ status: 'error', pesan: 'Gagal memotong saldo' });
            }

            db.query("INSERT INTO tb_transaksi (rfid_uid, berat_kg, total_biaya, status_pembayaran) VALUES (?, ?, ?, ?)",
            [rfid_uid, berat_kg, BIAYA_CUCI, 'LUNAS']);

            console.log(`✅ [IZIN DIBERIKAN] Mesin menyala untuk ${user.nama_user}. Berat: ${berat_kg}kg | Biaya: Rp ${BIAYA_CUCI} | Sisa Saldo: Rp ${sisaSaldo}`);
            
            res.status(200).json({
                status: 'izinkan',
                pesan: `Silakan mencuci, ${user.nama_user}`,
                total_biaya: BIAYA_CUCI,
                sisa_saldo: sisaSaldo
            });
        });
    });
});

// 7. Endpoint untuk Top-Up Saldo
app.post('/api/user/topup', (req, res) => {
    const { rfid_uid, nominal } = req.body;

    if (!rfid_uid || !nominal || nominal <= 0) {
        return res.status(400).json({ status: 'error', pesan: 'UID atau nominal tidak valid!' });
    }

    const querySQL = "UPDATE tb_user SET saldo = saldo + ? WHERE rfid_uid = ?";
    
    db.query(querySQL, [nominal, rfid_uid], (err, result) => {
        if (err) {
            console.error('❌ Gagal Top-Up:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gagal memproses Top-Up' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', pesan: 'Kartu tidak terdaftar!' });
        }

        console.log(`💸 [TOP-UP] Kartu ${rfid_uid} berhasil diisi Rp ${nominal}`);
        res.status(200).json({ status: 'success', pesan: `Top-Up Rp ${nominal} berhasil!` });
    });
});

// 8. Endpoint untuk Menarik Data Riwayat Transaksi (Untuk Tabel Admin)
app.get('/api/transaksi', (req, res) => {
    const querySQL = `
        SELECT t.id_transaksi, u.nama_user, t.total_biaya, t.waktu_transaksi 
        FROM tb_transaksi t 
        JOIN tb_user u ON t.rfid_uid = u.rfid_uid 
        ORDER BY t.waktu_transaksi DESC LIMIT 10
    `;

    db.query(querySQL, (err, results) => {
        if (err) {
            console.error('❌ Gagal menarik riwayat:', err);
            return res.status(500).json({ status: 'error', pesan: 'Gagal mengambil data' });
        }
        res.status(200).json({ status: 'success', data: results });
    });
});

// 9. Endpoint untuk Login Akun (Owner & Admin)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'owner' && password === 'owner123') {
        return res.status(200).json({ status: 'success', role: 'owner', nama: 'Danish (Owner)' });
    } else if (username === 'admin' && password === 'admin123') {
        return res.status(200).json({ status: 'success', role: 'admin', nama: 'Abdul (Kasir)' });
    } else {
        return res.status(401).json({ status: 'error', pesan: 'Username atau password salah!' });
    }
});

// Variabel sementara untuk menyimpan UID dari ESP32
let uidTerakhir = "";

// 10. Endpoint untuk menerima tembakan UID dari ESP32 (Wokwi/Asli)
app.post('/api/iot/rfid_scan', (req, res) => {
    const { rfid_uid } = req.body;
    if (rfid_uid) {
        uidTerakhir = rfid_uid;
        console.log(`📶 [WOKWI] Menerima scan kartu: ${uidTerakhir}`);
        res.status(200).json({ status: 'success' });
    } else {
        res.status(400).json({ status: 'error' });
    }
});

// 11. Endpoint untuk Web Simulate agar bisa 'ngintip' apakah ada kartu masuk
app.get('/api/iot/rfid_scan', (req, res) => {
    res.status(200).json({ uid: uidTerakhir });
    uidTerakhir = ""; // Langsung hapus setelah dibaca biar mesin cuci nggak nyala berulang-ulang
});

// --- MENYALAKAN SERVER ---

const PORT = process.env.PORT || 3000;

// Blok if ini mencegah pesan "Server berjalan" muncul error di log Vercel, 
// tapi tetap bisa berjalan sempurna kalau kamu ngetes pakai 'node server.js' di laptop.
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server berjalan di port ${PORT}`);
    });
}

// WAJIB DITAMBAHKAN UNTUK VERCEL (Harus diletakkan di paling bawah setelah semua rute/API ditulis)
module.exports = app;