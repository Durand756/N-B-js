/**
 * Commande /rank - Génère et affiche une carte de rang avec HTML
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments (non utilisés)
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Configuration du système de niveaux
const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((Math.pow(level, 2) - level) * DELTA_NEXT) / 2);

// Stockage temporaire des données utilisateur
const userExp = new Map();

// Fonction pour obtenir l'avatar utilisateur via l'API Facebook
async function getUserAvatar(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return null;
    
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'picture.width(200).height(200)',
                access_token: PAGE_ACCESS_TOKEN
            },
            timeout: 10000
        });
        return response.data.picture?.data?.url || null;
    } catch (error) {
        return null;
    }
}

// Fonction pour obtenir le nom utilisateur via l'API Facebook
async function getUserName(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return `Utilisateur ${userId.substring(0, 8)}`;
    
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'name',
                access_token: PAGE_ACCESS_TOKEN
            },
            timeout: 10000
        });
        return response.data.name || `Utilisateur ${userId.substring(0, 8)}`;
    } catch (error) {
        return `Utilisateur ${userId.substring(0, 8)}`;
    }
}

// Génération du HTML pour la carte de rang
function generateRankCardHTML(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers, avatar } = data;
    const progress = Math.max(0, Math.min(100, (currentExp / expNextLevel) * 100));
    
    const avatarSrc = avatar || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9ImF2YXRhckdyYWRpZW50IiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzY2N2VlYTtzdG9wLW9wYWNpdHk6MSIgLz4KPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNzY0YmEyO3N0b3Atb3BhY2l0eToxIiAvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+CjxjaXJjbGUgY3g9IjYwIiBjeT0iNjAiIHI9IjYwIiBmaWxsPSJ1cmwoI2F2YXRhckdyYWRpZW50KSIvPgo8dGV4dCB4PSI2MCIgeT0iNzUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSI0MCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPvCfkYQ8L3RleHQ+Cjwvc3ZnPg==';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: 'Arial', sans-serif;
            background: transparent;
        }
        
        .rank-card {
            width: 800px;
            height: 300px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
            border-radius: 20px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        
        .rank-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.3);
            z-index: 1;
        }
        
        .content {
            position: relative;
            z-index: 2;
            padding: 30px;
            height: 240px;
            display: flex;
            align-items: flex-start;
        }
        
        .avatar-section {
            margin-right: 30px;
        }
        
        .avatar {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            border: 4px solid white;
            object-fit: cover;
            background: #667eea;
        }
        
        .info-section {
            flex: 1;
            color: white;
        }
        
        .username {
            font-size: 36px;
            font-weight: bold;
            margin: 0 0 10px 0;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .level {
            font-size: 48px;
            font-weight: bold;
            color: #FFD700;
            margin: 0 0 10px 0;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .rank {
            font-size: 24px;
            margin: 0 0 20px 0;
            opacity: 0.9;
        }
        
        .progress-section {
            margin-bottom: 20px;
        }
        
        .progress-bar {
            width: 400px;
            height: 30px;
            background: rgba(255,255,255,0.2);
            border-radius: 15px;
            overflow: hidden;
            position: relative;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00ff88 0%, #00d4ff 100%);
            width: ${progress}%;
            border-radius: 15px;
            transition: width 0.3s ease;
        }
        
        .progress-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 16px;
            font-weight: bold;
            color: white;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        }
        
        .total-exp {
            font-size: 20px;
            opacity: 0.9;
        }
        
        .decorations {
            position: absolute;
            right: 30px;
            top: 30px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 3;
        }
        
        .decoration {
            font-size: 30px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .glow {
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
            animation: glow 3s ease-in-out infinite alternate;
            z-index: 0;
        }
        
        @keyframes glow {
            from { opacity: 0.5; }
            to { opacity: 0.8; }
        }
    </style>
</head>
<body>
    <div class="rank-card">
        <div class="glow"></div>
        <div class="content">
            <div class="avatar-section">
                <img src="${avatarSrc}" alt="Avatar" class="avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: none; align-items: center; justify-content: center; font-size: 60px; border: 4px solid white;">👤</div>
            </div>
            <div class="info-section">
                <h1 class="username">${name}</h1>
                <div class="level">Niveau ${level}</div>
                <div class="rank">Rang #${rank} sur ${totalUsers}</div>
                <div class="progress-section">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                        <div class="progress-text">${currentExp}/${expNextLevel} XP (${Math.round(progress)}%)</div>
                    </div>
                </div>
                <div class="total-exp">XP Total: ${exp}</div>
            </div>
        </div>
        <div class="decorations">
            <div class="decoration">🏆</div>
            <div class="decoration">⭐</div>
            <div class="decoration">🎯</div>
        </div>
    </div>
</body>
</html>`;
}

// Génération d'une carte de rang avec Puppeteer
async function generateRankCardImage(data, ctx) {
    let browser;
    try {
        // Lancer Puppeteer
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 840, height: 340 });
        
        // Générer le HTML
        const html = generateRankCardHTML(data);
        
        // Charger le HTML
        await page.setContent(html);
        
        // Attendre que tout soit chargé
        await page.waitForTimeout(1000);
        
        // Prendre une capture d'écran
        const imageBuffer = await page.screenshot({
            type: 'png',
            clip: {
                x: 0,
                y: 0,
                width: 840,
                height: 340
            }
        });
        
        return imageBuffer;
        
    } catch (error) {
        ctx.log.error(`Erreur Puppeteer: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Génération d'une carte de rang textuelle (fallback)
function generateTextRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers } = data;
    
    const progressWidth = 20;
    const progress = Math.floor((currentExp / expNextLevel) * progressWidth);
    const progressBar = '█'.repeat(progress) + '░'.repeat(progressWidth - progress);
    
    return `🏆 **CARTE DE RANG** 🏆

👤 **${name}**
📊 **Niveau:** ${level}
🎯 **Rang:** #${rank}/${totalUsers}

📈 **Expérience:**
${progressBar} ${Math.round((currentExp / expNextLevel) * 100)}%
${currentExp}/${expNextLevel} XP (Total: ${exp} XP)

✨ Continue à discuter pour gagner plus d'XP !`;
}

// Fonction pour créer une URL accessible pour l'image
async function createAccessibleImageUrl(imageBuffer, userId, ctx) {
    try {
        if (process.env.SERVER_URL) {
            const tempDir = path.join(__dirname, '..', 'temp');
            
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const fileName = `rank_${userId}_${Date.now()}.png`;
            const filePath = path.join(tempDir, fileName);
            
            fs.writeFileSync(filePath, imageBuffer);
            
            const publicUrl = `${process.env.SERVER_URL}/temp/${fileName}`;
            
            return { filePath, url: publicUrl, isFile: true };
        }
        
        const base64 = imageBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        
        return { filePath: null, url: dataUrl, isFile: false };
        
    } catch (error) {
        ctx.log.warning(`⚠️ Erreur création URL image: ${error.message}`);
        return null;
    }
}

// Fonction pour nettoyer les fichiers temporaires
function cleanupTempFile(filePath) {
    if (!filePath) return;
    
    setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            // Nettoyage silencieux
        }
    }, 10000);
}

module.exports = async function cmdRank(senderId, args, ctx) {
    const { log, userList, addToMemory, saveDataImmediate } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        // Ajouter l'utilisateur s'il n'existe pas
        if (!userList.has(senderIdStr)) {
            userList.add(senderIdStr);
            await saveDataImmediate();
        }
        
        // Initialiser l'expérience si nécessaire
        if (!userExp.has(senderIdStr)) {
            userExp.set(senderIdStr, 150); // XP par défaut pour les tests
        }
        
        const exp = userExp.get(senderIdStr);
        const level = expToLevel(exp);
        const expForCurrentLevel = levelToExp(level);
        const expForNextLevel = levelToExp(level + 1);
        const expNextLevel = expForNextLevel - expForCurrentLevel;
        const currentExp = exp - expForCurrentLevel;
        
        // Calculer le rang
        const allUsersWithExp = Array.from(userExp.entries())
            .filter(([id, exp]) => exp > 0)
            .map(([id, exp]) => ({ id, exp }))
            .sort((a, b) => b.exp - a.exp);
        
        const userRank = allUsersWithExp.findIndex(user => user.id === senderIdStr) + 1;
        const totalUsers = Math.max(allUsersWithExp.length, 1);
        
        // Obtenir les informations utilisateur
        const [userName, userAvatar] = await Promise.all([
            getUserName(senderId, ctx),
            getUserAvatar(senderId, ctx)
        ]);
        
        const rankData = {
            name: userName,
            level: level,
            exp: exp,
            expNextLevel: expNextLevel,
            currentExp: currentExp,
            rank: userRank || 1,
            totalUsers: totalUsers,
            avatar: userAvatar
        };
        
        try {
            // Essayer de générer l'image avec Puppeteer
            const imageBuffer = await generateRankCardImage(rankData, ctx);
            
            if (!imageBuffer || imageBuffer.length === 0) {
                throw new Error("Buffer d'image vide");
            }
            
            const imageResult = await createAccessibleImageUrl(imageBuffer, senderIdStr, ctx);
            
            if (!imageResult) {
                throw new Error("Impossible de créer l'URL de l'image");
            }
            
            log.info(`🏆 Carte de rang générée (HTML→PNG) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
            
            if (imageResult.isFile) {
                cleanupTempFile(imageResult.filePath);
            }
            
            return {
                type: 'image',
                url: imageResult.url,
                caption: `🏆 Voici ta carte de rang, ${userName} ! ✨\n\n📊 Niveau ${level} • Rang #${userRank}/${totalUsers}\n💫 Continue à discuter pour gagner plus d'XP !`
            };
            
        } catch (imageError) {
            log.warning(`⚠️ Erreur génération image HTML pour ${userName}: ${imageError.message}`);
            // Fallback vers carte textuelle
            const rankCard = generateTextRankCard(rankData);
            log.info(`🏆 Carte de rang générée (texte fallback) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
            addToMemory(senderIdStr, 'assistant', rankCard);
            return rankCard;
        }
        
    } catch (error) {
        log.error(`❌ Erreur commande rank: ${error.message}`);
        return "💥 Oops ! Erreur lors de la génération de ta carte de rang ! Réessaie plus tard ! 💕";
    }
};

// Fonction d'extension pour ajouter de l'expérience
module.exports.addExp = function(userId, expGain = 1) {
    const userIdStr = String(userId);
    
    if (!userExp.has(userIdStr)) {
        userExp.set(userIdStr, 0);
    }
    
    const currentExp = userExp.get(userIdStr);
    const newExp = currentExp + expGain;
    userExp.set(userIdStr, newExp);
    
    const oldLevel = expToLevel(currentExp);
    const newLevel = expToLevel(newExp);
    
    return {
        expGained: expGain,
        totalExp: newExp,
        levelUp: newLevel > oldLevel,
        oldLevel: oldLevel,
        newLevel: newLevel
    };
};

// Fonction pour obtenir les données d'expérience
module.exports.getExpData = function() {
    return Object.fromEntries(userExp);
};

// Fonction pour charger les données d'expérience
module.exports.loadExpData = function(data) {
    if (data && typeof data === 'object') {
        Object.entries(data).forEach(([userId, exp]) => {
            if (typeof exp === 'number' && exp >= 0) {
                userExp.set(userId, exp);
            }
        });
    }
};
