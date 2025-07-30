/**
 * Commande /clan - Système de gestion de clans optimisé
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, saveDataImmediate, sendMessage } = ctx;
    
    // Structure simplifiée des données
    const initClanData = () => ({
        clans: {}, // {id: {id, name, leader, members: [], level, xp, treasury, units: {w, a, m}, lastDefeat, cooldown}}
        userClans: {}, // {userId: clanId}
        battles: {}, // Historique simplifié
        invites: {}, // {userId: [clanIds]}
        deletedClans: {}, // {userId: deleteTimestamp} - cooldown 3 jours
        counter: 0
    });
    
    // Initialisation des données
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
    
    // IDs courts et mémorisables
    const generateId = (type) => {
        data.counter = (data.counter || 0) + 1;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sans I, O, 0, 1
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
        // Par ID direct
        if (data.clans[nameOrId.toUpperCase()]) {
            return data.clans[nameOrId.toUpperCase()];
        }
        // Par nom (case-insensitive)
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
    
    const getCooldownTime = () => {
        const deleteTime = data.deletedClans[userId];
        if (!deleteTime) return 0;
        
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        return Math.max(0, threeDays - (Date.now() - deleteTime));
    };
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        return days > 0 ? `${days}j ${hours}h` : `${hours}h`;
    };
    
    const calculatePower = (clan) => {
        const base = clan.level * 100 + clan.members.length * 30;
        const units = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
        return base + units + Math.random() * 100;
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
        case 'créer':
            const clanName = args_parts.slice(1).join(' ');
            if (!clanName) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Créer un clan**\n\nUsage: `/clan create [nom du clan]`\nExemple: `/clan create Les Dragons Noirs`\n\n💡 Choisis un nom unique et mémorable !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu as déjà un clan ! Utilise `/clan leave` pour le quitter d'abord.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!canCreateClan()) {
                const timeLeft = formatTime(getCooldownTime());
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ Tu as supprimé un clan récemment !\n⏰ Attends encore ${timeLeft} pour en créer un nouveau.`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Vérifier nom unique
            if (findClan(clanName)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Ce nom existe déjà ! Choisis un autre nom pour ton clan.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const clanId = generateId('clan');
            data.clans[clanId] = {
                id: clanId,
                name: clanName,
                leader: userId,
                members: [userId],
                level: 1,
                xp: 0,
                treasury: 100,
                units: { w: 10, a: 5, m: 2 }, // warriors, archers, mages
                lastDefeat: null,
                createdAt: new Date().toISOString()
            };
            data.userClans[userId] = clanId;
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const createResponse = `🎉 **Clan "${clanName}" créé avec succès !**\n\n🆔 ID du clan: **${clanId}**\n👑 Tu es maintenant le chef\n💰 100 pièces d'or de départ\n⭐ Niveau 1\n⚔️ Armée de départ:\n   • 10 Guerriers 🗡️\n   • 5 Archers 🏹\n   • 2 Mages 🔮\n\n💡 Tape `/clan help` pour découvrir toutes les possibilités !`;
            addToMemory(userId, 'assistant', createResponse);
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return createResponse;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 Crée ton clan avec: `/clan create [nom]`\n📜 Ou rejoins un clan existant: `/clan list`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ **Protégé** (2h après défaite)' : '';
            const isChief = isLeader() ? '👑 **Chef**' : '👤 **Membre**';
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}**\n🆔 ${clan.id} • ${isChief}\n\n📊 **Statistiques:**\n⭐ Niveau ${clan.level}\n✨ XP: ${clan.xp}/${clan.level * 1000} (${nextXP} pour niveau suivant)\n👥 Membres: ${clan.members.length}/20\n💰 Trésorerie: ${clan.treasury} pièces\n\n⚔️ **Armée:**\n🗡️ ${clan.units.w} Guerriers\n🏹 ${clan.units.a} Archers\n🔮 ${clan.units.m} Mages\n\n${protection}`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef peut inviter des membres !**\n\n💡 Demande au chef de ton clan de t'accorder ce privilège avec `/clan promote`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Inviter un membre**\n\nUsage: `/clan invite @utilisateur`\nExemple: `/clan invite @JohnDoe`\n\n💡 L'utilisateur recevra une invitation qu'il pourra accepter avec `/clan join`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan complet !**\n\n👥 Limite: 20 membres maximum\n💡 Certains membres peuvent quitter pour faire de la place";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (data.userClans[targetUser]) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne fait déjà partie d'un autre clan !\n\n💡 Elle doit d'abord quitter son clan actuel avec `/clan leave`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu as déjà invité cette personne !\n\n⏳ Elle peut accepter l'invitation avec `/clan join`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const inviteResponse = `📨 **Invitation envoyée !**\n\n👤 ${args_parts[1]} a été invité(e) dans **${inviterClan.name}**\n\n💡 Il/elle peut rejoindre avec:\n\`/clan join ${inviterClan.id}\` ou \`/clan join ${inviterClan.name}\``;
            addToMemory(userId, 'assistant', inviteResponse);
            return inviteResponse;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    addToMemory(userId, 'user', `/clan ${args}`);
                    const response = "📬 **Aucune invitation reçue**\n\n💡 Pour rejoindre un clan:\n• Demande une invitation à un chef de clan\n• Utilise `/clan list` pour voir les clans disponibles\n• Utilise `/clan join [ID ou nom]` si tu as une invitation";
                    addToMemory(userId, 'assistant', response);
                    return response;
                }
                
                let inviteList = "📬 **TES INVITATIONS**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        const protection = isProtected(c) ? '🛡️' : '';
                        inviteList += `${i+1}. **${c.name}** (${clanId}) ${protection}\n`;
                        inviteList += `   ⭐ Niveau ${c.level} • 👥 ${c.members.length}/20 • 💰 ${c.treasury} pièces\n\n`;
                    }
                });
                inviteList += "💡 Pour rejoindre: `/clan join [ID ou nom du clan]`";
                
                addToMemory(userId, 'user', `/clan ${args}`);
                addToMemory(userId, 'assistant', inviteList);
                return inviteList;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu fais déjà partie d'un clan !\n\n💡 Utilise `/clan leave` pour quitter ton clan actuel";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const joinClan = findClan(joinArg);
            if (!joinClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan introuvable !**\n\n💡 Vérifications:\n• L'ID ou le nom est-il correct ?\n• Utilise `/clan list` pour voir les clans disponibles\n• As-tu bien reçu une invitation ?";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[userId]?.includes(joinClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Tu n'es pas invité(e) dans "${joinClan.name}" !**\n\n💡 Demande une invitation au chef du clan ou utilise `/clan join` pour voir tes invitations`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (joinClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan complet !**\n\n👥 Ce clan a atteint sa limite de 20 membres";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Rejoindre
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const joinResponse = `🎉 **Bienvenue dans "${joinClan.name}" !**\n\n🆔 ID du clan: ${joinClan.id}\n👥 Membres: ${joinClan.members.length}/20\n⭐ Niveau ${joinClan.level}\n💰 Trésorerie: ${joinClan.treasury} pièces\n\n💡 Utilise `/clan info` pour voir tous les détails !`;
            addToMemory(userId, 'assistant', joinResponse);
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return joinResponse;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu ne fais partie d'aucun clan !\n\n🏰 Crée un clan avec: `/clan create [nom]`\n📜 Ou rejoins un clan: `/clan list`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isLeader() && leaveClan.members.length > 1) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Tu es le chef et le clan a d'autres membres !**\n\n💡 Deux options:\n👑 Promouvoir un nouveau chef: \`/clan promote @membre\`\n💥 Ou dissoudre le clan en faisant partir tous les membres d'abord`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isLeader()) {
                // Dissoudre le clan
                const clanName = leaveClan.name;
                leaveClan.members.forEach(memberId => {
                    delete data.userClans[memberId];
                });
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now(); // Cooldown de 3 jours
                await save();
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const dissolveResponse = `💥 **Clan "${clanName}" dissous !**\n\n⏰ Tu pourras créer un nouveau clan dans 3 jours\n💡 Cette période évite la création/suppression abusive de clans`;
                addToMemory(userId, 'assistant', dissolveResponse);
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return dissolveResponse;
            } else {
                // Quitter seulement
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const leaveResponse = `👋 **Tu as quitté "${leaveClan.name}"**\n\n🏰 Tu peux maintenant:\n• Créer ton propre clan: \`/clan create [nom]\`\n• Rejoindre un autre clan: \`/clan list\``;
                addToMemory(userId, 'assistant', leaveResponse);
                return leaveResponse;
            }

        case 'battle':
        case 'attaque':
            const attackerClan = getUserClan();
            if (!attackerClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan pour combattre !\n\n🏰 Crée un clan avec: `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyArg = args_parts[1];
            if (!enemyArg) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Attaquer un clan ennemi**\n\nUsage: `/clan battle [ID ou nom du clan]`\nExemple: `/clan battle ABCD` ou `/clan battle Dragons`\n\n💡 Utilise `/clan list` pour voir les clans disponibles\n⚠️ Les clans protégés (🛡️) ne peuvent pas être attaqués";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan ennemi introuvable !**\n\n💡 Vérifications:\n• L'ID ou le nom est-il correct ?\n• Utilise `/clan list` pour voir tous les clans\n• Le clan existe-t-il encore ?";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (enemyClan.id === attackerClan.id) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu ne peux pas attaquer ton propre clan !\n\n💡 Trouve un autre clan à combattre avec `/clan list`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isProtected(enemyClan)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `🛡️ **${enemyClan.name} est protégé !**\n\n⏳ Protection active pendant 2h après une défaite\n💡 Choisis un autre adversaire avec \`/clan list\``;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Combat
            const attackerPower = calculatePower(attackerClan);
            const defenderPower = calculatePower(enemyClan);
            const victory = attackerPower > defenderPower;
            
            // Gains/Pertes
            const xpGain = victory ? 200 : 50;
            const goldChange = victory ? 100 : -50;
            const enemyXP = victory ? 50 : 150;
            const enemyGold = victory ? -75 : 75;
            
            // Appliquer
            const levelUp = addXP(attackerClan, xpGain);
            const enemyLevelUp = addXP(enemyClan, enemyXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGold);
            
            // Protection pour le perdant
            if (!victory) {
                attackerClan.lastDefeat = Date.now();
            } else {
                enemyClan.lastDefeat = Date.now();
            }
            
            // Pertes d'unités
            const myLosses = Math.floor(Math.random() * 3) + 1;
            const enemyLosses = victory ? Math.floor(Math.random() * 4) + 2 : Math.floor(Math.random() * 2) + 1;
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - Math.floor(myLosses * 0.6));
            attackerClan.units.a = Math.max(0, attackerClan.units.a - Math.floor(myLosses * 0.3));
            attackerClan.units.m = Math.max(0, attackerClan.units.m - Math.floor(myLosses * 0.1));
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - Math.floor(enemyLosses * 0.6));
            enemyClan.units.a = Math.max(0, enemyClan.units.a - Math.floor(enemyLosses * 0.3));
            enemyClan.units.m = Math.max(0, enemyClan.units.m - Math.floor(enemyLosses * 0.1));
            
            // Historique des batailles
            if (!data.battles) data.battles = {};
            const battleId = `B${Date.now()}`;
            data.battles[battleId] = {
                id: battleId,
                date: new Date().toISOString(),
                attacker: {
                    id: attackerClan.id,
                    name: attackerClan.name,
                    power: Math.round(attackerPower)
                },
                defender: {
                    id: enemyClan.id,
                    name: enemyClan.name,
                    power: Math.round(defenderPower)
                },
                result: victory ? 'attacker_win' : 'defender_win',
                xp_gained: {
                    attacker: xpGain,
                    defender: enemyXP
                }
            };
            
            await save();
            
            // Notifier le défenseur
            if (enemyClan.members[0] !== userId) {
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, victory);
            }
            
            let battleResult = `⚔️ **BATAILLE: ${attackerClan.name} VS ${enemyClan.name}**\n\n`;
            if (victory) {
                battleResult += `🏆 **VICTOIRE ÉCLATANTE !**\n\n📈 **Gains:**\n✨ +${xpGain} XP\n💰 +${goldChange} pièces d'or\n${levelUp ? '🆙 **NIVEAU SUPÉRIEUR !**\n' : ''}`;
                battleResult += `\n💀 **Pertes:** ${myLosses} unités\n🛡️ Ennemi protégé pendant 2h`;
            } else {
                battleResult += `💥 **DÉFAITE COURAGEUSE...**\n\n📈 **Gains malgré la défaite:**\n✨ +${xpGain} XP (expérience de combat)\n💰 ${goldChange} pièces (pillage partiel)\n`;
                battleResult += `💀 **Pertes:** ${myLosses} unités\n🛡️ **Ton clan est maintenant protégé pendant 2h**`;
            }
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', battleResult);
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${victory ? 'Victoire attaquant' : 'Victoire défenseur'}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans)
                .sort((a, b) => b.level - a.level || b.xp - a.xp)
                .slice(0, 10);
            
            if (topClans.length === 0) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "🏰 **Aucun clan existant !**\n\nSois le premier à créer un clan !\n\n💡 Utilise: `/clan create [nom de ton clan]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let list = "🏆 **CLASSEMENT DES CLANS**\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? ' 🛡️' : '';
                const power = Math.round(calculatePower(clan));
                
                list += `${medal} **${clan.name}** (${clan.id})${protection}\n`;
                list += `   ⭐ Niveau ${clan.level} • 👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n`;
                list += `   ⚔️ Puissance: ${power} • 🗡️${clan.units.w} 🏹${clan.units.a} 🔮${clan.units.m}\n\n`;
            });
            
            const userClan = getUserClan();
            if (userClan) {
                const userRank = topClans.findIndex(c => c.id === userClan.id) + 1;
                if (userRank > 0) {
                    list += `📍 **Ton clan "${userClan.name}" est ${userRank}${userRank === 1 ? 'er' : 'ème'} !**\n`;
                }
            }
            
            list += `\n💡 Total: ${Object.keys(data.clans).length} clans actifs`;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', list);
            return list;

        case 'units':
        case 'unités':
            const unitsClan = getUserClan();
            if (!unitsClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 Crée un clan avec: `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                const totalPower = unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15;
                addToMemory(userId, 'user', `/clan ${args}`);
                const unitsResponse = `⚔️ **ARMÉE DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w} (Force: ${unitsClan.units.w * 10})\n🏹 **Archers:** ${unitsClan.units.a} (Force: ${unitsClan.units.a * 8})\n🔮 **Mages:** ${unitsClan.units.m} (Force: ${unitsClan.units.m * 15})\n\n💪 **Puissance totale:** ${totalPower}\n💰 **Trésorerie:** ${unitsClan.treasury} pièces\n\n💰 **PRIX D'ACHAT:**\n🗡️ Guerrier: 40 pièces\n🏹 Archer: 60 pièces\n🔮 Mage: 80 pièces\n\n💡 **Acheter:** \`/clan units [type] [nombre]\`\n📝 **Exemple:** \`/clan units guerrier 5\`\n\n⚠️ Seul le chef peut acheter des unités !`;
                addToMemory(userId, 'assistant', unitsResponse);
                return unitsResponse;
            }
            
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef peut acheter des unités !**\n\n💡 Les achats d'unités affectent tout le clan, donc seul le chef a ce privilège\n👑 Demande une promotion si tu veux gérer les achats";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let cost = 0;
            let unitKey = '';
            let unitName = '';
            
            if (['guerrier', 'g', 'warrior', 'guerre'].includes(unitType)) {
                cost = 40 * quantity;
                unitKey = 'w';
                unitName = 'Guerrier';
            } else if (['archer', 'a', 'arc'].includes(unitType)) {
                cost = 60 * quantity;
                unitKey = 'a';
                unitName = 'Archer';
            } else if (['mage', 'm', 'magic', 'magicien'].includes(unitType)) {
                cost = 80 * quantity;
                unitKey = 'm';
                unitName = 'Mage';
            } else {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Type d'unité invalide !**\n\n💡 Types disponibles:\n🗡️ **guerrier** ou **g** (40 pièces)\n🏹 **archer** ou **a** (60 pièces)\n🔮 **mage** ou **m** (80 pièces)\n\n📝 Exemple: `/clan units mage 3`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (quantity < 1 || quantity > 50) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Quantité invalide !**\n\n💡 Tu peux acheter entre 1 et 50 unités à la fois";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (unitsClan.treasury < cost) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Fonds insuffisants !**\n\n💰 **Coût:** ${cost} pièces\n💰 **Disponible:** ${unitsClan.treasury} pièces\n💰 **Manque:** ${cost - unitsClan.treasury} pièces\n\n💡 Gagne de l'or en remportant des batailles !`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            const newPower = unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const buyResponse = `✅ **Achat réussi !**\n\n🛒 **Acheté:** ${quantity} ${unitName}${quantity > 1 ? 's' : ''}\n💰 **Coût:** ${cost} pièces\n💰 **Reste:** ${unitsClan.treasury} pièces\n\n⚔️ **Nouvelle armée:**\n🗡️ ${unitsClan.units.w} Guerriers\n🏹 ${unitsClan.units.a} Archers\n🔮 ${unitsClan.units.m} Mages\n💪 **Puissance:** ${newPower}\n\n🎯 Ton clan est maintenant plus fort pour les batailles !`;
            addToMemory(userId, 'assistant', buyResponse);
            return buyResponse;

        case 'promote':
        case 'promouvoir':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef actuel peut promouvoir !**\n\n👑 Cette action transfère le leadership du clan\n💡 Demande au chef actuel de te promouvoir";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "👑 **Promouvoir un nouveau chef**\n\nUsage: `/clan promote @membre`\nExemple: `/clan promote @JohnDoe`\n\n⚠️ **ATTENTION:** Tu ne seras plus le chef après cette action !\n💡 Le nouveau chef aura tous les privilèges (inviter, acheter unités, etc.)";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Cette personne n'est pas membre de ton clan !**\n\n💡 Seuls les membres actuels peuvent devenir chef\n👥 Utilise `/clan info` pour voir la liste des membres";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (newLeader === userId) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu es déjà le chef !\n\n💡 Si tu veux promouvoir quelqu'un d'autre, mentionne un autre membre";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            promoteClan.leader = newLeader;
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const promoteResponse = `👑 **NOUVEAU CHEF NOMMÉ !**\n\n🎉 ${args_parts[1]} est maintenant le chef de **${promoteClan.name}** !\n\n📋 **Privilèges transférés:**\n• Inviter/exclure des membres\n• Acheter des unités\n• Promouvoir d'autres membres\n• Dissoudre le clan\n\n💡 Tu es maintenant un membre normal du clan`;
            addToMemory(userId, 'assistant', promoteResponse);
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return promoteResponse;

        case 'stats':
            if (!ctx.isAdmin(userId)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Commande réservée aux administrateurs !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const totalClans = Object.keys(data.clans).length;
            const totalMembers = Object.values(data.clans).reduce((sum, clan) => sum + clan.members.length, 0);
            const totalBattles = Object.keys(data.battles || {}).length;
            const averageLevel = totalClans > 0 ? (Object.values(data.clans).reduce((sum, clan) => sum + clan.level, 0) / totalClans).toFixed(1) : 0;
            const topClanForStats = Object.values(data.clans).sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const statsResponse = `📊 **STATISTIQUES GLOBALES**\n\n🏰 **Clans actifs:** ${totalClans}\n👥 **Total membres:** ${totalMembers}\n⚔️ **Batailles livrées:** ${totalBattles}\n📈 **Niveau moyen:** ${averageLevel}\n\n🔝 **Clan dominant:** ${topClanForStats?.name || 'Aucun'}\n📅 **Dernière mise à jour:** ${new Date().toLocaleString()}\n\n💾 Système de sauvegarde opérationnel`;
            addToMemory(userId, 'assistant', statsResponse);
            return statsResponse;

        case 'help':
        case 'aide':
            addToMemory(userId, 'user', `/clan ${args}`);
            const helpResponse = `⚔️ **GUIDE COMPLET DES CLANS**\n\n🏰 **GESTION DE BASE:**\n• \`/clan create [nom]\` - Créer ton clan (coût: gratuit)\n• \`/clan info\` - Voir les détails de ton clan\n• \`/clan list\` - Classement des clans\n• \`/clan leave\` - Quitter/dissoudre ton clan\n\n👥 **GESTION DES MEMBRES:**\n• \`/clan invite @user\` - Inviter quelqu'un (chef uniquement)\n• \`/clan join [id/nom]\` - Rejoindre un clan (sur invitation)\n• \`/clan promote @user\` - Nommer un nouveau chef (chef uniquement)\n\n⚔️ **COMBAT & STRATÉGIE:**\n• \`/clan battle [id/nom]\` - Attaquer un autre clan\n• \`/clan units\` - Voir ton armée et les prix\n• \`/clan units [type] [nombre]\` - Acheter des unités (chef uniquement)\n\n💡 **CONSEILS STRATÉGIQUES:**\n• Les Mages (🔮) sont les plus puissants mais coûteux\n• Les Guerriers (🗡️) sont nombreux et abordables\n• Les Archers (🏹) offrent un bon équilibre\n• Gagne de l'XP et de l'or en combattant\n• Les clans vaincus sont protégés 2h\n• Maximum 20 membres par clan\n\n🎯 **OBJECTIFS:**\n• Monter de niveau (1000 XP par niveau)\n• Agrandir ton clan (inviter des amis)\n• Dominer le classement\n• Accumuler des richesses\n\n❓ Des questions ? Utilise \`/clan\` pour un aperçu rapide !`;
            addToMemory(userId, 'assistant', helpResponse);
            return helpResponse;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ Protégé' : '';
                const isChief = isLeader() ? '👑 Chef' : '👤 Membre';
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `🏰 **${userClan.name}** (${userClan.id})\n${isChief} • ⭐ Niveau ${userClan.level} • 👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury} ${protection}\n\n💡 **Actions rapides:**\n• \`/clan info\` - Détails complets\n• \`/clan battle [clan]\` - Combattre\n• \`/clan help\` - Guide complet\n\n⚔️ Prêt pour la bataille ?`;
                addToMemory(userId, 'assistant', response);
                return response;
            } else {
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `⚔️ **BIENVENUE DANS LE SYSTÈME DE CLANS !**\n\n🆕 **Tu n'as pas encore de clan !**\n\n🚀 **COMMENCER:**\n🏰 \`/clan create [nom]\` - Créer ton propre clan\n📜 \`/clan list\` - Voir les clans existants\n📬 \`/clan join\` - Voir tes invitations\n\n❓ **BESOIN D'AIDE ?**\n\`/clan help\` - Guide complet avec tous les détails\n\n💡 **Astuce:** Commence par créer ton clan ou demande une invitation à un ami qui en a déjà un !\n\n🎯 Rejoins la bataille pour la domination !`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
    }
};
