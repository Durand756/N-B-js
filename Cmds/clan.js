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
        clans: {}, // {id: {id, name, leader, members: [], level, xp, treasury, units: {w, a, m}, lastDefeat, lastVictory}}
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
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return days > 0 ? `${days}j ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };
    
    const calculatePower = (clan) => {
        const base = clan.level * 100 + clan.members.length * 30;
        const units = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
        const xpBonus = Math.floor(clan.xp / 100) * 5;
        return base + units + xpBonus;
    };
    
    const isProtected = (clan) => {
        if (clan.lastDefeat && (Date.now() - clan.lastDefeat) < (60 * 60 * 1000)) return true; // 1h après défaite
        if (clan.lastVictory && (Date.now() - clan.lastVictory) < (60 * 60 * 1000)) return true; // 1h après victoire
        return false;
    };
    
    const canAttack = (attackerClan, defenderClan) => {
        // Vérifie si les clans se sont déjà attaqués récemment
        const lastBattleKey = `${attackerClan.id}-${defenderClan.id}`;
        const lastBattleTime = data.battles[lastBattleKey];
        
        return !lastBattleTime || (Date.now() - lastBattleTime) >= (60 * 60 * 1000); // 1h cooldown
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
        const msg = `⚔️ ATTAQUE ! ${attackerName} contre ${defenderName} - ${result}`;
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
                return "⚔️ `/clan create [nom]`";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan !";
            
            if (!canCreateClan()) {
                const timeLeft = formatTime(3 * 24 * 60 * 60 * 1000 - (Date.now() - data.deletedClans[userId]));
                return `❌ Attends encore ${timeLeft}`;
            }
            
            if (findClan(clanName)) return "❌ Nom déjà pris !";
            
            const clanId = generateId('clan');
            data.clans[clanId] = {
                id: clanId, name: clanName, leader: userId, members: [userId],
                level: 1, xp: 0, treasury: 100,
                units: { w: 10, a: 5, m: 2 }, 
                lastDefeat: null,
                lastVictory: null
            };
            data.userClans[userId] = clanId;
            await save();
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return `╔════════════════════╗\n║ 🔥 CLAN CRÉÉ 🔥 ║\n╚════════════════════╝\n\n🏰 ${clanName}\n🆔 ${clanId} | 👑 Chef | 💰 100\n\n⚔️ ARMÉE:\n┣━━ 🗡️ 10 guerriers\n┣━━ 🏹 5 archers\n┗━━ 🔮 2 mages\n\n╰─▸ Ton empire commence !`;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Pas de clan ! `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️' : '';
            const totalPower = calculatePower(clan);
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `╔════════════════════╗\n║ 🏰 INFO CLAN 🏰 ║\n╚════════════════════╝\n\n🏰 ${clan.name} ${protection}\n🆔 ${clan.id} | ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20\n⚡ Puissance: ${totalPower} pts\n💰 ${clan.treasury} pièces\n\n⚔️ ARMÉE:\n┣━━ 🗡️ ${clan.units.w} (+${clan.units.w * 10})\n┣━━ 🏹 ${clan.units.a} (+${clan.units.a * 8})\n┗━━ 🔮 ${clan.units.m} (+${clan.units.m * 15})\n\n✨ PROGRESSION:\n┣━━ ${clan.xp} XP\n┗━━ ${nextXP} pour niv.${clan.level + 1}\n\n╰─▸ /clan help pour commander`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) return "❌ Chef seulement !";
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) return "⚔️ `/clan invite @user`";
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) return "❌ Clan plein !";
            if (data.userClans[targetUser]) return "❌ Il a déjà un clan !";
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) return "❌ Déjà invité !";
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            return `╔════════════════════╗\n║ 📨 INVITATION 📨 ║\n╚════════════════════╝\n\n🏰 ${args_parts[1]} invité dans ${inviterClan.name}\n🆔 Code: ${inviterClan.id}\n\n╰─▸ Il peut faire /clan join ${inviterClan.id}`;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) return "❌ Aucune invitation !";
                
                let inviteList = "╔════════════════════╗\n║ 📬 INVITATIONS 📬 ║\n╚════════════════════╝\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        inviteList += `┣━━ ${c.name} (${clanId})\n┃   ⭐ Niv.${c.level}\n`;
                    }
                });
                return inviteList + "\n╰─▸ /clan join [id]";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan !";
            
            const joinClan = findClan(joinArg);
            if (!joinClan) return "❌ Clan introuvable !";
            if (!data.invites[userId]?.includes(joinClan.id)) return "❌ Pas invité !";
            if (joinClan.members.length >= 20) return "❌ Clan plein !";
            
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return `╔════════════════════╗\n║ 🔥 CLAN REJOINT 🔥 ║\n╚════════════════════╝\n\n🏰 ${joinClan.name}\n👥 ${joinClan.members.length}/20 guerriers\n\n╰─▸ Bienvenue dans la guerre !`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ Pas de clan !";
            
            if (isLeader() && leaveClan.members.length > 1) {
                return "❌ Nomme un successeur ! `/clan promote @membre`";
            }
            
            if (isLeader()) {
                const clanName = leaveClan.name;
                leaveClan.members.forEach(memberId => delete data.userClans[memberId]);
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                await save();
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return `╔════════════════════╗\n║ 💥 CLAN DÉTRUIT 💥 ║\n╚════════════════════╝\n\n🏰 ${clanName} n'existe plus\n⏰ Cooldown: 3 jours\n\n╰─▸ L'empire est tombé...`;
            } else {
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                return `╔════════════════════╗\n║ 👋 CLAN QUITTÉ 👋 ║\n╚════════════════════╝\n\n🏰 Tu quittes ${leaveClan.name}\n\n╰─▸ Bonne chance guerrier !`;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ Pas de clan !";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) return "⚔️ `/clan battle [id]`";
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return "❌ Ennemi introuvable !";
            if (enemyClan.id === attackerClan.id) return "❌ Pas d'auto-attaque !";
            if (isProtected(enemyClan)) return `🛡️ ${enemyClan.name} protégé !`;
            
            // Vérification du cooldown entre ces deux clans spécifiques
            if (!canAttack(attackerClan, enemyClan)) {
                return `⏳ Déjà combattu récemment !`;
            }
            
            // Calcul des puissances avec un peu d'aléatoire pour plus de dynamisme
            const attackerPower = calculatePower(attackerClan) * (0.95 + Math.random() * 0.1);
            const defenderPower = calculatePower(enemyClan) * (0.95 + Math.random() * 0.1);
            const powerDiff = attackerPower - defenderPower;
            
            // Détermination du résultat
            let result, xpGain, goldChange, enemyXP, enemyGold;
            
            if (Math.abs(powerDiff) < Math.max(attackerPower, defenderPower) * 0.05) { // Match nul (5% de différence)
                result = 'draw';
                xpGain = 100;
                goldChange = 0;
                enemyXP = 100;
                enemyGold = 0;
            } else if (powerDiff > 0) { // Victoire attaquant
                result = 'victory';
                xpGain = 200;
                goldChange = Math.min(100, enemyClan.treasury * 0.2); // 20% du trésor ennemi (max 100)
                enemyXP = 50;
                enemyGold = -goldChange;
            } else { // Défaite attaquant
                result = 'defeat';
                xpGain = 50;
                goldChange = -Math.min(50, attackerClan.treasury * 0.1); // 10% du trésor (max 50)
                enemyXP = 150;
                enemyGold = -goldChange;
            }
            
            // Application des gains/pertes
            const attackerLevelUp = addXP(attackerClan, xpGain);
            const defenderLevelUp = addXP(enemyClan, enemyXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGold);
            
            // Pertes d'unités proportionnelles à la difficulté
            const attackerLossRate = result === 'victory' ? 0.1 : result === 'defeat' ? 0.3 : 0.2;
            const defenderLossRate = result === 'victory' ? 0.3 : result === 'defeat' ? 0.1 : 0.2;
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - Math.floor(attackerClan.units.w * attackerLossRate * 0.6));
            attackerClan.units.a = Math.max(0, attackerClan.units.a - Math.floor(attackerClan.units.a * attackerLossRate * 0.3));
            attackerClan.units.m = Math.max(0, attackerClan.units.m - Math.floor(attackerClan.units.m * attackerLossRate * 0.1));
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - Math.floor(enemyClan.units.w * defenderLossRate * 0.6));
            enemyClan.units.a = Math.max(0, enemyClan.units.a - Math.floor(enemyClan.units.a * defenderLossRate * 0.3));
            enemyClan.units.m = Math.max(0, enemyClan.units.m - Math.floor(enemyClan.units.m * defenderLossRate * 0.1));
            
            // Enregistrement des protections
            if (result === 'victory') {
                attackerClan.lastVictory = Date.now();
                enemyClan.lastDefeat = Date.now();
            } else if (result === 'defeat') {
                attackerClan.lastDefeat = Date.now();
                enemyClan.lastVictory = Date.now();
            }
            
            // Enregistrement du combat
            const battleKey = `${attackerClan.id}-${enemyClan.id}`;
            data.battles[battleKey] = Date.now();
            
            await save();
            
            // Notifier le défenseur
            if (enemyClan.members[0] !== userId) {
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, result === 'victory');
            }
            
            // Construction du résultat
            let battleResult = `╔════════════════════╗\n║ ⚔️ BATAILLE ⚔️ ║\n╚════════════════════╝\n\n🔥 ${attackerClan.name} VS ${enemyClan.name}\n💪 ${Math.round(attackerPower)} pts | ${Math.round(defenderPower)} pts\n\n`;
            
            if (result === 'victory') {
                battleResult += `🏆 VICTOIRE !\n✨ +${xpGain} XP | 💰 +${goldChange}${attackerLevelUp ? '\n🆙 NIVEAU UP !' : ''}`;
            } else if (result === 'defeat') {
                battleResult += `💀 DÉFAITE !\n✨ +${xpGain} XP | 💰 ${goldChange}\n🛡️ Protection 1h`;
            } else {
                battleResult += `🤝 MATCH NUL !\n✨ +${xpGain} XP chacun\n💰 Pas de pillage`;
            }
            
            battleResult += `\n\n╰─▸ Prépare la revanche !`;
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${result}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans)
                .sort((a, b) => calculatePower(b) - calculatePower(a))
                .slice(0, 10);
            
            if (topClans.length === 0) return "❌ Aucun clan ! `/clan create [nom]`";
            
            let list = `╔════════════════════╗\n║ 🏆 CLASSEMENT 🏆 ║\n╚════════════════════╝\n\n`;
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '⚔️';
                const totalPower = calculatePower(clan);
                
                list += `${medal} ${clan.name} ${protection}\n`;
                list += `┣━━ 📊 ${totalPower} pts | ⭐ Niv.${clan.level}\n`;
                list += `┣━━ 👥 ${clan.members.length}/20 | 💰 ${clan.treasury}\n`;
                list += `┗━━ 🗡️${clan.units.w} 🏹${clan.units.a} 🔮${clan.units.m}\n\n`;
            });
            
            list += `Total: ${Object.keys(data.clans).length} clans\n╰─▸ Attaque ceux sans 🛡️ !`;
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ Pas de clan !";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                return `╔════════════════════╗\n║ ⚔️ ARMÉE ⚔️ ║\n╚════════════════════╝\n\n🏰 ${unitsClan.name}\n💰 ${unitsClan.treasury} pièces\n\n📊 UNITÉS:\n┣━━ 🗡️ ${unitsClan.units.w} guerriers (+${unitsClan.units.w * 10})\n┣━━ 🏹 ${unitsClan.units.a} archers (+${unitsClan.units.a * 8})\n┗━━ 🔮 ${unitsClan.units.m} mages (+${unitsClan.units.m * 15})\n\n🛒 PRIX:\n┣━━ guerrier: 40💰\n┣━━ archer: 60💰\n┗━━ mage: 80💰\n\n╰─▸ /clan units [type] [nb]`;
            }
            
            if (!isLeader()) return "❌ Chef seulement !";
            
            let cost = 0, unitKey = '', unitName = '', powerPerUnit = 0;
            if (['guerrier', 'g', 'warrior'].includes(unitType)) { 
                cost = 40 * quantity; 
                unitKey = 'w'; 
                unitName = 'guerriers'; 
                powerPerUnit = 10; 
            }
            else if (['archer', 'a'].includes(unitType)) { 
                cost = 60 * quantity; 
                unitKey = 'a'; 
                unitName = 'archers'; 
                powerPerUnit = 8; 
            }
            else if (['mage', 'm'].includes(unitType)) { 
                cost = 80 * quantity; 
                unitKey = 'm'; 
                unitName = 'mages'; 
                powerPerUnit = 15; 
            }
            else return "❌ Type invalide ! (guerrier, archer, mage)";
            
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ Pas assez ! Coût: ${cost}💰 (manque ${missing}💰)`;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            return `╔════════════════════╗\n║ 🛒 RECRUTEMENT 🛒 ║\n╚════════════════════╝\n\n⚔️ ${quantity} ${unitName} recrutés\n💰 Reste: ${unitsClan.treasury}\n⚡ +${quantity * powerPerUnit} pts\n\n╰─▸ Armée renforcée !`;

        case 'promote':
            if (!isLeader()) return "❌ Chef seulement !";
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) return "⚔️ `/clan promote @user`";
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) return "❌ Pas dans le clan !";
            
            promoteClan.leader = newLeader;
            await save();
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return `╔════════════════════╗\n║ 👑 PROMOTION 👑 ║\n╚════════════════════╝\n\n🏰 ${promoteClan.name}\n👑 ${args_parts[1]} est le nouveau chef\n\n╰─▸ Longue vie au roi !`;

        case 'help':
             return `╔════════════════════╗\n║ ⚔️ GUIDE CLAN ⚔️ ║\n╚════════════════════╝\n\n🏰 BASE:\n┣━━ /clan create [nom]\n┣━━ /clan info\n┗━━ /clan list\n\n👥 ÉQUIPE:\n┣━━ /clan invite @user\n┣━━ /clan join [id]\n┣━━ /clan leave\n┗━━ /clan promote @user\n\n⚔️ GUERRE:\n┣━━ /clan battle [id]\n┗━━ /clan units\n\n════════════════════\n📊 Puissance = Niv×100 + Membres×30\n💡 Mages = 15 pts (+ efficace !)\n\n╰─▸ Forge ton destin ! 🔥`;
        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️' : '';
                return `╔════════════════════╗\n║ ⚔️ TON CLAN ⚔️ ║\n╚════════════════════╝\n\n🏰 ${userClan.name} ${protection}\n🆔 ${userClan.id} | ⭐ Niv.${userClan.level}\n👥 ${userClan.members.length}/20 | 💰 ${userClan.treasury}\n\n╰─▸ /clan help pour commander`;
            } else {
                return `╔════════════════════╗\n║ ⚔️ SYSTÈME CLAN ⚔️ ║\n╚════════════════════╝\n\n🏰 /clan create [nom]\n📜 /clan list\n❓ /clan help\n\n╰─▸ Crée ton empire !`;
            }
    }
};
