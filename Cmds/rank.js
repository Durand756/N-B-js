/**
 * Commande /rank - Affiche le niveau et l'expérience utilisateur
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments (non utilisés)
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');

// Configuration du système de niveaux
const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((Math.pow(level, 2) - level) * DELTA_NEXT) / 2);

// Stockage temporaire des données utilisateur (sera sauvegardé sur GitHub)
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

// Génération d'une carte de rang textuelle
function generateTextRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers } = data;
    
    // Barre de progression simple
    const progressWidth = 20;
    const progress = Math.floor((currentExp / expNextLevel) * progressWidth);
    const progressBar = '█'.repeat(progress) + '░'.repeat(progressWidth - progress);
    
    return `🏆 **CARTE DE RANG** 🏆

👤 **${name}**
📊 **Niveau:** ${level}
🎯 **Rang:** #${rank}/${totalUsers}

📈 **Expérience:**
${progressBar} ${Math.round((currentExp / expNextLevel) * 100)}%
${currentExp}/${expNextLevel} XP

✨ Tape /help pour découvrir d'autres commandes !`;
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
        
        const rankCard = generateTextRankCard(rankData);
        
        log.info(`🏆 Carte de rang générée pour ${senderId} - Niveau ${level}, Rang #${userRank}`);
        
        // Enregistrer en mémoire
        addToMemory(senderIdStr, 'assistant', rankCard);
        
        return rankCard;
        
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
