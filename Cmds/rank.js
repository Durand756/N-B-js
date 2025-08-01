/**
 * Commande /rank - Génère et affiche une carte de rang avec image
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments (non utilisés)
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

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
        // Suppression du console.error pour éviter les messages indésirables
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
        // Suppression du console.error pour éviter les messages indésirables
        return `Utilisateur ${userId.substring(0, 8)}`;
    }
}

// Fonction pour créer un avatar par défaut
function createDefaultAvatar() {
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    
    // Fond dégradé
    const gradient = ctx.createLinearGradient(0, 0, 100, 100);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 100, 100);
    
    // Icône utilisateur
    ctx.fillStyle = 'white';
    ctx.font = 'bold 50px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('👤', 50, 65);
    
    return canvas;
}

// Fonction pour dessiner un avatar circulaire
async function drawCircularAvatar(ctx, avatarUrl, x, y, size) {
    try {
        let avatarCanvas;
        
        if (avatarUrl) {
            const avatar = await loadImage(avatarUrl);
            avatarCanvas = createCanvas(size, size);
            const avatarCtx = avatarCanvas.getContext('2d');
            avatarCtx.drawImage(avatar, 0, 0, size, size);
        } else {
            avatarCanvas = createDefaultAvatar();
        }
        
        // Créer le masque circulaire
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatarCanvas, x, y, size, size);
        ctx.restore();
        
        // Bordure
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
        ctx.stroke();
        
    } catch (error) {
        // Dessiner avatar par défaut en cas d'erreur (silencieux)
        const defaultAvatar = createDefaultAvatar();
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(defaultAvatar, x, y, size, size);
        ctx.restore();
    }
}

// Génération de la carte de rang avec Canvas
async function generateRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers, avatar } = data;
    
    // Dimensions de la carte
    const width = 800;
    const height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Fond dégradé
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(0.5, '#764ba2');
    gradient.addColorStop(1, '#f093fb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Overlay semi-transparent
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);
    
    // Avatar
    await drawCircularAvatar(ctx, avatar, 30, 30, 120);
    
    // Nom d'utilisateur
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.fillText(name, 180, 70);
    
    // Niveau
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 48px Arial';
    ctx.fillText(`Niveau ${level}`, 180, 120);
    
    // Rang
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.fillText(`Rang #${rank} sur ${totalUsers}`, 180, 150);
    
    // Barre de progression - Fond
    const barX = 180;
    const barY = 180;
    const barWidth = 400;
    const barHeight = 30;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.roundRect(barX, barY, barWidth, barHeight, 15);
    ctx.fill();
    
    // Barre de progression - Remplissage
    const progress = currentExp / expNextLevel;
    const progressWidth = barWidth * progress;
    
    const progressGradient = ctx.createLinearGradient(barX, barY, barX + progressWidth, barY);
    progressGradient.addColorStop(0, '#00ff88');
    progressGradient.addColorStop(1, '#00d4ff');
    
    ctx.fillStyle = progressGradient;
    ctx.roundRect(barX, barY, progressWidth, barHeight, 15);
    ctx.fill();
    
    // Texte de progression
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${currentExp}/${expNextLevel} XP (${Math.round(progress * 100)}%)`, 
                 barX + barWidth/2, barY + barHeight/2 + 6);
    
    // XP Total
    ctx.textAlign = 'left';
    ctx.font = '20px Arial';
    ctx.fillText(`XP Total: ${exp}`, 180, 250);
    
    // Décorations
    ctx.fillStyle = '#FFD700';
    ctx.font = '30px Arial';
    ctx.fillText('🏆', width - 80, 50);
    ctx.fillText('⭐', width - 80, 100);
    ctx.fillText('🎯', width - 80, 150);
    
    return canvas.toBuffer('image/png');
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
        // Option 1: Essayer d'utiliser l'URL du serveur si définie
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
        
        // Option 2: Fallback vers Data URL (Base64)
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
    if (!filePath) return; // Pas de fichier à nettoyer (cas Base64)
    
    setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            // Nettoyage silencieux - pas de log d'erreur
        }
    }, 10000); // Nettoyer après 10 secondes
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
            userExp.set(senderIdStr, 0);
        }
        
        const exp = userExp.get(senderIdStr);
        const level = expToLevel(exp);
        const expForCurrentLevel = levelToExp(level);
        const expForNextLevel = levelToExp(level + 1);
        const expNextLevel = expForNextLevel - expForCurrentLevel;
        const currentExp = exp - expForCurrentLevel;
        
        // Calculer le rang (tous les utilisateurs avec de l'XP)
        const allUsersWithExp = Array.from(userExp.entries())
            .filter(([id, exp]) => exp > 0)
            .map(([id, exp]) => ({ id, exp }))
            .sort((a, b) => b.exp - a.exp);
        
        const userRank = allUsersWithExp.findIndex(user => user.id === senderIdStr) + 1;
        const totalUsers = allUsersWithExp.length;
        
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
            totalUsers: Math.max(totalUsers, 1),
            avatar: userAvatar
        };
        
        try {
            // Essayer de générer l'image
            const imageBuffer = await generateRankCard(rankData);
            const imageResult = await createAccessibleImageUrl(imageBuffer, senderIdStr, ctx);
            
            if (!imageResult) {
                throw new Error("Impossible de créer l'URL de l'image");
            }
            
            log.info(`🏆 Carte de rang générée (${imageResult.isFile ? 'fichier' : 'base64'}) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
            
            // Programmer le nettoyage du fichier temporaire si nécessaire
            if (imageResult.isFile) {
                cleanupTempFile(imageResult.filePath);
            }
            
            // ✅ NOUVELLE LOGIQUE: Retourner l'objet image selon le format du fichier mère
            return {
                type: 'image',
                url: imageResult.url,
                caption: `🏆 Voici ta carte de rang, ${userName} ! ✨\n\n📊 Niveau ${level} • Rang #${userRank}/${totalUsers}\n💫 Continue à discuter pour gagner plus d'XP !`
            };
            
        } catch (imageError) {
            log.warning(`⚠️ Erreur génération image pour ${userName}: ${imageError.message}`);
            // Fallback vers carte textuelle
            const rankCard = generateTextRankCard(rankData);
            log.info(`🏆 Carte de rang générée (texte) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
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
