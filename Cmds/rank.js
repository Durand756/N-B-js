/**
 * Commande /rank - Génère une carte de rang sophistiquée avec Canvas
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments (non utilisés)
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');

// Configuration du système de niveaux
const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((Math.pow(level, 2) - level) * DELTA_NEXT) / 2);

// Stockage temporaire des données utilisateur (sera sauvegardé sur GitHub)
const userExp = new Map();

// Couleurs et styles pour différents niveaux
const getLevelTheme = (level) => {
    if (level >= 50) return {
        bg: { r: 138, g: 43, b: 226 }, // Violet profond
        accent: { r: 255, g: 215, b: 0 }, // Or
        progressBg: 'rgba(255, 215, 0, 0.2)',
        progressFill: 'linear-gradient(90deg, #FFD700, #FFA500)',
        title: '👑 MAÎTRE LÉGENDAIRE'
    };
    if (level >= 30) return {
        bg: { r: 220, g: 20, b: 60 }, // Rouge cramoisi
        accent: { r: 255, g: 69, b: 0 }, // Rouge orangé
        progressBg: 'rgba(255, 69, 0, 0.2)',
        progressFill: 'linear-gradient(90deg, #FF4500, #FF6347)',
        title: '🔥 EXPERT ÉLITE'
    };
    if (level >= 20) return {
        bg: { r: 70, g: 130, b: 180 }, // Bleu acier
        accent: { r: 0, g: 191, b: 255 }, // Bleu ciel
        progressBg: 'rgba(0, 191, 255, 0.2)',
        progressFill: 'linear-gradient(90deg, #00BFFF, #1E90FF)',
        title: '⚡ VÉTÉRAN CONFIRMÉ'
    };
    if (level >= 10) return {
        bg: { r: 34, g: 139, b: 34 }, // Vert forêt
        accent: { r: 0, g: 255, b: 127 }, // Vert printemps
        progressBg: 'rgba(0, 255, 127, 0.2)',
        progressFill: 'linear-gradient(90deg, #00FF7F, #32CD32)',
        title: '🌟 AVENTURIER EXPÉRIMENTÉ'
    };
    return {
        bg: { r: 75, g: 0, b: 130 }, // Indigo
        accent: { r: 147, g: 112, b: 219 }, // Violet moyen
        progressBg: 'rgba(147, 112, 219, 0.2)',
        progressFill: 'linear-gradient(90deg, #9370DB, #8A2BE2)',
        title: '✨ DÉBUTANT PROMETTEUR'
    };
};

// Fonction pour créer un dégradé
const createGradient = (ctx, x, y, width, height, color1, color2) => {
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    return gradient;
};

// Fonction pour dessiner des étoiles d'arrière-plan
const drawStars = (ctx, width, height, count = 50) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < count; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const size = Math.random() * 2 + 1;
        
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
};

// Fonction pour dessiner une barre de progression animée
const drawProgressBar = (ctx, x, y, width, height, progress, theme) => {
    // Arrière-plan de la barre
    ctx.fillStyle = theme.progressBg;
    ctx.fillRect(x, y, width, height);
    
    // Bordure
    ctx.strokeStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 0.8)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    
    // Remplissage progressif
    if (progress > 0) {
        const fillWidth = (width - 4) * progress;
        const gradient = createGradient(ctx, x + 2, y + 2, fillWidth, height - 4, 
            `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 1)`,
            `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 0.7)`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 2, y + 2, fillWidth, height - 4);
        
        // Effet de brillance
        const glowGradient = ctx.createLinearGradient(x + 2, y + 2, x + 2, y + height - 2);
        glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        glowGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        
        ctx.fillStyle = glowGradient;
        ctx.fillRect(x + 2, y + 2, fillWidth, (height - 4) / 2);
    }
};

// Fonction pour dessiner un avatar avec bordure et ombre
const drawAvatar = async (ctx, avatarUrl, x, y, size) => {
    try {
        // Ombre portée
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;
        
        // Cercle de bordure
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2 + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();
        
        // Réinitialiser l'ombre
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        if (avatarUrl) {
            const avatar = await loadImage(avatarUrl);
            
            // Masquer en cercle
            ctx.save();
            ctx.beginPath();
            ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
            ctx.clip();
            
            ctx.drawImage(avatar, x, y, size, size);
            ctx.restore();
        } else {
            // Avatar par défaut
            ctx.fillStyle = '#6A5ACD';
            ctx.beginPath();
            ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Icône utilisateur
            ctx.font = `${size/2}px Arial`;
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('👤', x + size/2, y + size/2);
        }
    } catch (error) {
        // Avatar par défaut en cas d'erreur
        ctx.fillStyle = '#6A5ACD';
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.font = `${size/2}px Arial`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👤', x + size/2, y + size/2);
    }
};

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
    if (!PAGE_ACCESS_TOKEN) return `Nakama ${userId.substring(0, 8)}`;
    
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'name',
                access_token: PAGE_ACCESS_TOKEN
            },
            timeout: 10000
        });
        return response.data.name || `Nakama ${userId.substring(0, 8)}`;
    } catch (error) {
        return `Nakama ${userId.substring(0, 8)}`;
    }
}

// Génération de la carte de rang sophistiquée
async function generateRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers, avatar } = data;
    
    // Dimensions de la carte
    const width = 800;
    const height = 400;
    
    // Créer le canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Obtenir le thème selon le niveau
    const theme = getLevelTheme(level);
    
    // Arrière-plan dégradé
    const bgGradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width/2);
    bgGradient.addColorStop(0, `rgba(${theme.bg.r}, ${theme.bg.g}, ${theme.bg.b}, 1)`);
    bgGradient.addColorStop(1, `rgba(${Math.floor(theme.bg.r * 0.6)}, ${Math.floor(theme.bg.g * 0.6)}, ${Math.floor(theme.bg.b * 0.6)}, 1)`);
    
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);
    
    // Étoiles d'arrière-plan
    drawStars(ctx, width, height, 60);
    
    // Bordure décorative
    ctx.strokeStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 0.8)`;
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    
    // Avatar
    await drawAvatar(ctx, avatar, 50, 50, 120);
    
    // Badge de niveau
    const levelBadgeX = 140;
    const levelBadgeY = 50;
    ctx.fillStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 0.9)`;
    ctx.beginPath();
    ctx.roundRect(levelBadgeX, levelBadgeY, 80, 40, 20);
    ctx.fill();
    
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level.toString(), levelBadgeX + 40, levelBadgeY + 20);
    
    // Titre de niveau
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 1)`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(theme.title, 250, 60);
    
    // Nom utilisateur
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillText(name, 250, 100);
    
    // Réinitialiser l'ombre
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Rang
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 1)`;
    ctx.fillText(`🏆 Rang #${rank} / ${totalUsers}`, 250, 150);
    
    // Section expérience
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText(`💫 Expérience: ${exp} XP`, 50, 220);
    
    // Barre de progression
    const progressBarX = 50;
    const progressBarY = 250;
    const progressBarWidth = 500;
    const progressBarHeight = 30;
    const progress = currentExp / expNextLevel;
    
    drawProgressBar(ctx, progressBarX, progressBarY, progressBarWidth, progressBarHeight, progress, theme);
    
    // Texte de progression
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText(`${currentExp} / ${expNextLevel} XP (${Math.round(progress * 100)}%)`, 
                 progressBarX + progressBarWidth/2, progressBarY + progressBarHeight + 25);
    
    // Prochain niveau
    ctx.font = '18px Arial';
    ctx.fillStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 1)`;
    ctx.fillText(`✨ Prochain niveau: ${level + 1} (${expNextLevel - currentExp} XP restants)`, 
                 progressBarX + progressBarWidth/2, progressBarY + progressBarHeight + 50);
    
    // Décorations supplémentaires
    if (level >= 10) {
        // Ajouter des étoiles spéciales pour les niveaux élevés
        const starPositions = [
            {x: 700, y: 80}, {x: 720, y: 100}, {x: 740, y: 120},
            {x: 680, y: 120}, {x: 760, y: 140}
        ];
        
        ctx.fillStyle = `rgba(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b}, 0.8)`;
        starPositions.forEach(pos => {
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('⭐', pos.x, pos.y);
        });
    }
    
    // Signature
    ctx.font = '12px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('💖 NakamaBot - Créé avec amour par Durand', width - 20, height - 20);
    
    return canvas.toBuffer('image/png');
}

// Fonction principale de la commande
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
        const expNextLevel = levelToExp(level + 1) - levelToExp(level);
        const currentExp = expNextLevel - (levelToExp(level + 1) - exp);
        
        // Calculer le rang
        const allUsers = Array.from(userExp.entries())
            .map(([id, exp]) => ({ id, exp }))
            .sort((a, b) => b.exp - a.exp);
        
        const userRank = allUsers.findIndex(user => user.id === senderIdStr) + 1;
        const totalUsers = allUsers.length;
        
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
            rank: userRank,
            totalUsers: totalUsers,
            avatar: userAvatar
        };
        
        // Générer l'image de la carte
        const imageBuffer = await generateRankCard(rankData);
        
        // Convertir en base64 pour l'envoi
        const base64Image = imageBuffer.toString('base64');
        const imageUrl = `data:image/png;base64,${base64Image}`;
        
        log.info(`🏆 Carte de rang générée pour ${senderId} - Niveau ${level}, Rang #${userRank}`);
        
        // Enregistrer en mémoire
        addToMemory(senderIdStr, 'assistant', `[Carte de rang générée - Niveau ${level}]`);
        
        // Retourner l'objet image pour l'envoi
        return {
            type: 'image',
            url: imageUrl,
            caption: `🏆 Voici ta magnifique carte de rang ! Niveau ${level} 💖\n✨ Continue à chatter pour gagner de l'XP !`
        };
        
    } catch (error) {
        log.error(`❌ Erreur commande rank: ${error.message}`);
        return "💥 Oops ! Petite erreur lors de la génération de ta carte de rang ! Réessaie dans un moment ! 💕";
    }
};

// Fonction d'extension pour ajouter de l'expérience (appelée depuis le fichier principal)
module.exports.addExp = function(userId, expGain = 1) {
    const userIdStr = String(userId);
    
    if (!userExp.has(userIdStr)) {
        userExp.set(userIdStr, 0);
    }
    
    const currentExp = userExp.get(userIdStr);
    const newExp = currentExp + expGain;
    userExp.set(userIdStr, newExp);
    
    // Vérifier si l'utilisateur a monté de niveau
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

// Fonction pour obtenir les données d'expérience (pour la sauvegarde GitHub)
module.exports.getExpData = function() {
    return Object.fromEntries(userExp);
};

// Fonction pour charger les données d'expérience (depuis GitHub)
module.exports.loadExpData = function(data) {
    if (data && typeof data === 'object') {
        Object.entries(data).forEach(([userId, exp]) => {
            if (typeof exp === 'number' && exp >= 0) {
                userExp.set(userId, exp);
            }
        });
    }
};
