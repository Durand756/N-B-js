// Commande /rank - Génère et affiche une carte de rang avec image corrigée

const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((Math.pow(level, 2) - level) * DELTA_NEXT) / 2);
const userExp = new Map();

async function getUserAvatar(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return null;

    try {
        const res = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'picture.width(200).height(200)',
                access_token: PAGE_ACCESS_TOKEN
            }, timeout: 10000
        });
        return res.data.picture?.data?.url || null;
    } catch (_) {
        return null;
    }
}

async function getUserName(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return `Utilisateur ${userId.substring(0, 8)}`;

    try {
        const res = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: { fields: 'name', access_token: PAGE_ACCESS_TOKEN }, timeout: 10000
        });
        return res.data.name || `Utilisateur ${userId.substring(0, 8)}`;
    } catch (_) {
        return `Utilisateur ${userId.substring(0, 8)}`;
    }
}

function createDefaultAvatar() {
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 100, 100);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 50px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👤', 50, 65);
    return canvas;
}

async function drawCircularAvatar(ctx, avatarUrl, x, y, size) {
    try {
        let avatarCanvas;
        if (avatarUrl) {
            const avatar = await loadImage(avatarUrl);
            avatarCanvas = createCanvas(size, size);
            avatarCanvas.getContext('2d').drawImage(avatar, 0, 0, size, size);
        } else {
            avatarCanvas = createDefaultAvatar();
        }
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatarCanvas, x, y, size, size);
        ctx.restore();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.stroke();
    } catch (_) {
        const fallback = createDefaultAvatar();
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(fallback, x, y, size, size);
        ctx.restore();
    }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

async function generateRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers, avatar } = data;
    const canvas = createCanvas(800, 300);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 800, 300);
    bg.addColorStop(0, '#00c6ff');
    bg.addColorStop(1, '#0072ff');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 300);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, 800, 300);

    await drawCircularAvatar(ctx, avatar, 30, 30, 120);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(name, 180, 70);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(`Niveau ${level}`, 180, 120);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.fillText(`Rang #${rank} sur ${totalUsers}`, 180, 150);

    const barX = 180, barY = 180, barW = 400, barH = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    drawRoundedRect(ctx, barX, barY, barW, barH, 15);

    const progress = currentExp / expNextLevel;
    const progressW = barW * progress;
    const progGrad = ctx.createLinearGradient(barX, barY, barX + progressW, barY);
    progGrad.addColorStop(0, '#00ff88');
    progGrad.addColorStop(1, '#00d4ff');
    ctx.fillStyle = progGrad;
    drawRoundedRect(ctx, barX, barY, progressW, barH, 15);

    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${currentExp}/${expNextLevel} XP (${Math.round(progress * 100)}%)`, barX + barW / 2, barY + barH / 2 + 6);

    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillText(`XP Total: ${exp}`, 180, 250);

    ctx.font = '30px sans-serif';
    ctx.fillText('🏆', 720, 50);
    ctx.fillText('⭐', 720, 100);
    ctx.fillText('🎯', 720, 150);

    return canvas.toBuffer('image/png');
}

module.exports = async function cmdRank(senderId, args, ctx) {
    const { log, userList, addToMemory, saveDataImmediate } = ctx;
    const senderIdStr = String(senderId);

    try {
        if (!userList.has(senderIdStr)) {
            userList.add(senderIdStr);
            await saveDataImmediate();
        }
        if (!userExp.has(senderIdStr)) userExp.set(senderIdStr, 0);

        const exp = userExp.get(senderIdStr);
        const level = expToLevel(exp);
        const expForCurrent = levelToExp(level);
        const expForNext = levelToExp(level + 1);
        const expNext = expForNext - expForCurrent;
        const current = exp - expForCurrent;

        const allUsers = Array.from(userExp.entries())
            .filter(([_, exp]) => exp > 0)
            .map(([id, exp]) => ({ id, exp }))
            .sort((a, b) => b.exp - a.exp);
        const userRank = allUsers.findIndex(u => u.id === senderIdStr) + 1;
        const totalUsers = allUsers.length;

        const [name, avatar] = await Promise.all([
            getUserName(senderId, ctx),
            getUserAvatar(senderId, ctx)
        ]);

        const rankData = { name, level, exp, expNextLevel: expNext, currentExp: current, rank: userRank || 1, totalUsers: Math.max(1, totalUsers), avatar };

        try {
            const imgBuffer = await generateRankCard(rankData);
            const base64 = imgBuffer.toString('base64');
            return {
                type: 'image',
                url: `data:image/png;base64,${base64}`,
                caption: `🏆 Voici ta carte de rang, ${name} ! ✨\n\n📊 Niveau ${level} • Rang #${userRank}/${totalUsers}\n💫 Continue à discuter pour gagner plus d'XP !`
            };
        } catch (imgErr) {
            log.warning(`Erreur génération image : ${imgErr.message}`);
            return `📛 Impossible de créer l'image. Nom: ${name}, XP: ${exp}`;
        }
    } catch (err) {
        log.error(`Erreur /rank: ${err.message}`);
        return `🚨 Erreur lors de la commande rank.`;
    }
};

module.exports.addExp = function(userId, gain = 1) {
    const id = String(userId);
    const oldExp = userExp.get(id) || 0;
    const newExp = oldExp + gain;
    userExp.set(id, newExp);
    const oldLevel = expToLevel(oldExp);
    const newLevel = expToLevel(newExp);
    return { expGained: gain, totalExp: newExp, levelUp: newLevel > oldLevel, oldLevel, newLevel };
};

module.exports.getExpData = () => Object.fromEntries(userExp);

module.exports.loadExpData = (data) => {
    if (data && typeof data === 'object') {
        for (const [id, xp] of Object.entries(data)) {
            if (typeof xp === 'number' && xp >= 0) userExp.set(id, xp);
        }
    }
};
