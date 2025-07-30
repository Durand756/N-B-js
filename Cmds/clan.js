/**
 * Commande /clan - Système de gestion de clans optimisé
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, saveDataImmediate, sendMessage } = ctx;
    
    // Initialisation des données
    const initClanData = () => ({
        clans: {}, // {id: {id, name, leader, members: [], level, xp, treasury, units: {w, a, m}, lastDefeat}}
        userClans: {}, // {userId: clanId}
        battles: {}, // Historique des batailles
        invites: {}, // {userId: [clanIds]}
        deletedClans: {}, // {userId: deleteTimestamp} - cooldown 3 jours
        counter: 0
    });
    
    if (!ctx.clanData) {
        ctx.clanData = initClanData();
        await saveDataImmediate();
        ctx.log.info("🏰 Structure des clans initialisée");
    }
    let data = ctx.clanData;
    
    const userId = String(senderId);
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    
    // === UTILITAIRES ===
    
    // Génération d'IDs courts
    const generateId = (type) => {
        data.counter = (data.counter || 0) + 1;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let id = '';
        let num = data.counter + Date.now() % 10000;
        
        for (let i = 0; i < (type === 'clan' ? 4 : 3); i++) {
            id = chars[num % chars.length] + id;
            num = Math.floor(num / chars.length);
        }
        return id;
    };
    
    const getUserClan = () => {
        const clanId = data.userClans[userId];
        return clanId ? data.clans[clanId] : null;
    };
    
    const findClan = (nameOrId) => {
        if (data.clans[nameOrId.toUpperCase()]) {
            return data.clans[nameOrId.toUpperCase()];
        }
        return Object.values(data.clans).find(c => 
            c.name.toLowerCase() === nameOrId.toLowerCase()
        );
    };
    
    const isLeader = () => {
        const clan = getUserClan();
        return clan?.leader === userId;
    };
    
    const canCreateClan = () => {
        const deleteTime = data.deletedClans[userId];
        if (!deleteTime) return true;
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        return (Date.now() - deleteTime) > threeDays;
    };
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        return days > 0 ? `${days}j ${hours}h` : `${hours}h`;
    };
    
    const calculatePower = (clan) => {
        const base = clan.level * 100 + clan.members.length * 30;
        const units = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
        const xpBonus = Math.floor(clan.xp / 100) * 5; // 5 points par 100 XP
        return base + units + xpBonus;
    };
    
    const isProtected = (clan) => {
        if (!clan.lastDefeat) return false;
        return (Date.now() - clan.lastDefeat) < (2 * 60 * 60 * 1000); // 2h
    };
    
    const addXP = (clan, amount) => {
        clan.xp += amount;
        const newLevel = Math.floor(clan.xp / 1000) + 1;
        if (newLevel > clan.level) {
            clan.level = newLevel;
            return true;
        }
        return false;
    };
    
    const save = async () => {
        ctx.clanData = data;
        await saveDataImmediate();
    };
    
    // Notification d'attaque
    const notifyAttack = async (defenderId, attackerName, defenderName, won) => {
        const result = won ? 'victoire' : 'défaite';
        const msg = `⚔️ BATAILLE ! ${attackerName} a attaqué ${defenderName}\n🏆 Résultat: ${result} pour ${won ? attackerName : defenderName}`;
        try {
            await sendMessage(defenderId, msg);
        } catch (err) {
            ctx.log.debug(`❌ Notification non envoyée à ${defenderId}`);
        }
    };
    
    // === COMMANDES ===
    
    switch (action) {
        case 'create':
            const clanName = args_parts.slice(1).join(' ');
            if (!clanName) {
                return "⚔️ Usage: `/clan create [nom]`\nExemple: `/clan create Dragons` 🐉";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan ! Utilise `/clan leave` d'abord.";
            
            if (!canCreateClan()) {
                const timeLeft = formatTime(getCooldownTime());
                return `❌ Tu as supprimé un clan récemment !\n⏰ Attends encore ${timeLeft} pour en créer un nouveau.`;
            }
            
            if (findClan(clanName)) return "❌ Ce nom existe déjà ! Choisis autre chose.";
            
            const clanId = generateId('clan');
            data.clans[clanId] = {
                id: clanId, name: clanName, leader: userId, members: [userId],
                level: 1, xp: 0, treasury: 100,
                units: { w: 10, a: 5, m: 2 }, lastDefeat: null
            };
            data.userClans[userId] = clanId;
            await save();
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return `🎉 Clan "${clanName}" créé !\n🆔 ID: **${clanId}**\n👑 Tu es le chef\n💰 100 pièces • ⭐ Niveau 1\n⚔️ 10 guerriers, 5 archers, 2 mages`;

        case 'info':
            const clan = getUserClan();
            if (!clan) return "❌ Tu n'as pas de clan ! `/clan create [nom]`";
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ Protégé ' : '';
            
            return `🏰 **${clan.name}**\n🆔 ${clan.id} • ⭐ Niv.${clan.level}\n👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n✨ XP: ${clan.xp} (${nextXP} pour +1)\n⚔️ ${clan.units.w}g ${clan.units.a}a ${clan.units.m}m\n${protection}`;

        case 'invite':
            if (!isLeader()) return "❌ Seul le chef peut inviter !";
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) return "⚔️ Usage: `/clan invite @utilisateur`";
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) return "❌ Clan plein ! (20 max)";
            if (data.userClans[targetUser]) return "❌ Cette personne a déjà un clan !";
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) return "❌ Déjà invité !";
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            return `📨 ${args_parts[1]} invité dans **${inviterClan.name}** !\nIl peut rejoindre avec: \`/clan join ${inviterClan.id}\``;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) return "❌ Aucune invitation ! Usage: `/clan join [id]`";
                
                let inviteList = "📬 **TES INVITATIONS**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        inviteList += `${i+1}. **${c.name}** (${clanId})\n   👥 ${c.members.length}/20 • ⭐ Niv.${c.level}\n\n`;
                    }
                });
                return inviteList + "Pour rejoindre: `/clan join [id]`";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan !";
            
            const joinClan = findClan(joinArg);
            if (!joinClan) return "❌ Clan introuvable !";
            if (!data.invites[userId]?.includes(joinClan.id)) return "❌ Tu n'es pas invité dans ce clan !";
            if (joinClan.members.length >= 20) return "❌ Clan plein !";
            
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return `🎉 Tu as rejoint **${joinClan.name}** !\n🆔 ${joinClan.id} • 👥 ${joinClan.members.length}/20`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ Tu n'as pas de clan !";
            
            if (isLeader() && leaveClan.members.length > 1) {
                return "❌ Promeus un nouveau chef d'abord ! `/clan promote @membre`";
            }
            
            if (isLeader()) {
                const clanName = leaveClan.name;
                leaveClan.members.forEach(memberId => delete data.userClans[memberId]);
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                await save();
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return `💥 Clan "${clanName}" dissous !\n⏰ Tu pourras en créer un nouveau dans 3 jours.`;
            } else {
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                return `👋 Tu as quitté "${leaveClan.name}".`;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ Tu n'as pas de clan !";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) return "⚔️ Usage: `/clan battle [id ou nom]`";
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return "❌ Clan ennemi introuvable !";
            if (enemyClan.id === attackerClan.id) return "❌ Tu ne peux pas t'attaquer toi-même !";
            if (isProtected(enemyClan)) return `🛡️ ${enemyClan.name} est protégé !`;
            
            // Combat
            const attackerPower = calculatePower(attackerClan);
            const defenderPower = calculatePower(enemyClan);
            const victory = attackerPower > defenderPower;
            
            // Gains/Pertes
            const xpGain = victory ? 200 : 50;
            const goldChange = victory ? 100 : -50;
            const enemyXP = victory ? 50 : 150;
            const enemyGold = victory ? -75 : 75;
            
            const levelUp = addXP(attackerClan, xpGain);
            addXP(enemyClan, enemyXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGold);
            
            // Protection pour le perdant
            if (!victory) attackerClan.lastDefeat = Date.now();
            else enemyClan.lastDefeat = Date.now();
            
            // Pertes d'unités
            const myLosses = Math.floor(Math.random() * 3) + 1;
            const enemyLosses = victory ? Math.floor(Math.random() * 4) + 2 : Math.floor(Math.random() * 2) + 1;
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - Math.floor(myLosses * 0.6));
            attackerClan.units.a = Math.max(0, attackerClan.units.a - Math.floor(myLosses * 0.3));
            attackerClan.units.m = Math.max(0, attackerClan.units.m - Math.floor(myLosses * 0.1));
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - Math.floor(enemyLosses * 0.6));
            enemyClan.units.a = Math.max(0, enemyClan.units.a - Math.floor(enemyLosses * 0.3));
            enemyClan.units.m = Math.max(0, enemyClan.units.m - Math.floor(enemyLosses * 0.1));
            
            await save();
            
            // Notifier le défenseur
            if (enemyClan.members[0] !== userId) {
                const resultText = result === 'victory' ? 'victoire' : result === 'defeat' ? 'défaite' : 'match nul';
                const winnerName = result === 'victory' ? attackerClan.name : result === 'defeat' ? enemyClan.name : 'Match nul';
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, result === 'victory');
            }
            
            let battleResult = `⚔️ **${attackerClan.name} VS ${enemyClan.name}**\n`;
            battleResult += `💪 Puissance: ${Math.round(attackerPower)} vs ${Math.round(defenderPower)}\n\n`;
            
            if (result === 'victory') {
                battleResult += `🏆 **VICTOIRE !**\n✨ +${xpGain} XP | 💰 +${goldChange}\n${levelUp ? '🆙 NIVEAU UP !\n' : ''}💀 Pertes: ${myLosses} unités`;
            } else if (result === 'defeat') {
                battleResult += `🛡️ **DÉFAITE...**\n✨ +${xpGain} XP | 💰 ${goldChange}\n💀 Pertes: ${myLosses} unités\n🛡️ Protégé 2h`;
            } else {
                battleResult += `🤝 **MATCH NUL !**\n✨ +${xpGain} XP pour les deux clans\n💰 Pas de transfert d'or\n💀 Pertes minimales: ${myLosses} unités`;
            }
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${result === 'victory' ? 'Victoire attaquant' : result === 'defeat' ? 'Victoire défenseur' : 'Match nul'}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans)
                .sort((a, b) => b.level - a.level || b.xp - a.xp)
                .slice(0, 10);
            
            if (topClans.length === 0) return "❌ Aucun clan ! Crée le premier avec `/clan create [nom]`";
            
            let list = "🏆 **TOP CLANS**\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '';
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}\n   ⭐ Niv.${clan.level} • 👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n\n`;
            });
            
            return list + `Total: ${Object.keys(data.clans).length} clans`;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ Tu n'as pas de clan !";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                return `⚔️ **UNITÉS DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w} (+10 puissance chacun)\n🏹 **Archers:** ${unitsClan.units.a} (+8 puissance chacun)\n🔮 **Mages:** ${unitsClan.units.m} (+15 puissance chacun) ⭐\n\n💰 **Trésorerie:** ${unitsClan.treasury} pièces\n📊 **Puissance totale unités:** ${unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15} pts\n\n🛒 **ACHETER UNITÉS:**\n\`/clan units guerrier [nombre]\` - 40💰 (+10 pts)\n\`/clan units archer [nombre]\` - 60💰 (+8 pts)  \n\`/clan units mage [nombre]\` - 80💰 (+15 pts) 🌟\n\n💡 **Conseil:** Les mages ont le meilleur ratio puissance/prix !`;
            }
            
            if (!isLeader()) return "❌ Seul le chef peut acheter des unités !";
            
            let cost = 0, unitKey = '';
            if (['guerrier', 'g', 'warrior'].includes(unitType)) { cost = 40 * quantity; unitKey = 'w'; }
            else if (['archer', 'a'].includes(unitType)) { cost = 60 * quantity; unitKey = 'a'; }
            else if (['mage', 'm'].includes(unitType)) { cost = 80 * quantity; unitKey = 'm'; }
            else return "❌ Type invalide ! Utilise: guerrier, archer, ou mage";
            
            if (unitsClan.treasury < cost) return `❌ Fonds insuffisants ! Coût: ${cost}💰, Dispo: ${unitsClan.treasury}💰`;
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            return `✅ ${quantity} ${unitType}(s) acheté(s) pour ${cost}💰 !\n💰 Reste: ${unitsClan.treasury}💰`;

        case 'promote':
            if (!isLeader()) return "❌ Seul le chef peut promouvoir !";
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) return "⚔️ Usage: `/clan promote @nouveau_chef`";
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) return "❌ Cette personne n'est pas dans ton clan !";
            
            promoteClan.leader = newLeader;
            await save();
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return `👑 ${args_parts[1]} est le nouveau chef de **${promoteClan.name}** !`;

        case 'help':
            return `⚔️ **GUIDE COMPLET DES CLANS**\n\n🏰 **DÉMARRAGE:**\n• \`/clan create [nom]\` - Créer ton clan (nom unique)\n• \`/clan info\` - Voir toutes tes stats détaillées\n• \`/clan list\` - Top 10 des clans les plus forts\n\n👥 **GESTION D'ÉQUIPE:**\n• \`/clan invite @user\` - Inviter un ami (chef seulement)\n• \`/clan join [id]\` - Rejoindre avec un ID court (ex: A3B7)\n• \`/clan leave\` - Quitter ou dissoudre ton clan\n• \`/clan promote @user\` - Transférer le leadership\n\n⚔️ **SYSTÈME DE COMBAT:**\n• \`/clan battle [id/nom]\` - Attaquer un rival\n• \`/clan units\` - Gérer ton armée\n\n📈 **CALCUL DE PUISSANCE:**\n• Niveau: +100 pts/niveau\n• Membres: +30 pts/personne  \n• Guerriers: +10 pts chacun (40💰)\n• Archers: +8 pts chacun (60💰)\n• Mages: +15 pts chacun (80💰) - Les plus forts !\n• XP: +5 pts par 100 XP\n\n🏆 **RÉSULTATS DE COMBAT:**\n• **Victoire** (diff >10 pts): +200 XP, +100💰\n• **Match nul** (diff ≤10 pts): +100 XP, 0💰\n• **Défaite** (diff >10 pts): +50 XP, -50💰\n\n🛡️ **PROTECTION:** 2h après défaite\n💰 **ÉCONOMIE:** Gagne de l'or en gagnant, achète des unités\n📊 **PROGRESSION:** 1000 XP = +1 niveau\n\n💡 **STRATÉGIES GAGNANTES:**\n• Privilégie les MAGES (meilleur rapport puissance/prix)\n• Recrute des membres actifs (+30 pts chacun)\n• Monte en niveau avec les combats\n• Attaque les clans non-protégés\n• Évite les combats à puissance égale (match nul)`;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ Protégé' : '';
                return `🏰 **${userClan.name}** (${userClan.id})\n⭐ Niv.${userClan.level} • 👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury} ${protection}\n\nTape \`/clan help\` pour toutes les commandes !`;
            } else {
                return `⚔️ **BIENVENUE DANS LE SYSTÈME DE CLANS !**\n\nTu n'as pas encore de clan. Voici comment commencer :\n\n🏰 \`/clan create [nom]\` - Créer ton propre clan\n📜 \`/clan list\` - Voir tous les clans existants\n❓ \`/clan help\` - Guide complet des commandes\n\n💎 **Astuce:** Commence par créer ton clan, puis invite des amis pour devenir plus fort !`;
    }
};
};
