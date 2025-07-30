/**
 * Commande /clan - Système de gestion de clans optimisé avec sauvegarde GitHub
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
    
    // ✅ CORRECTION: Utiliser le nouveau système de sauvegarde
    if (!ctx.clanData) {
        ctx.clanData = initClanData();
        // Sauvegarder immédiatement la structure initiale
        await saveDataImmediate();
        ctx.log.info("🏰 Structure des clans initialisée et sauvegardée");
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
    
    // ✅ CORRECTION: Utiliser la nouvelle fonction de sauvegarde
    const save = async () => {
        ctx.clanData = data; // S'assurer que les données sont à jour dans le contexte
        await saveDataImmediate(); // Sauvegarde asynchrone sur GitHub
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
                const response = "⚔️ Usage: `/clan create [nom]`\nExemple: `/clan create Dragons` 🐉";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu as déjà un clan ! Utilise `/clan leave` d'abord.";
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
                const response = "❌ Ce nom existe déjà ! Choisis autre chose.";
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
                createdAt: new Date().toISOString() // ✅ AJOUT: Date de création
            };
            data.userClans[userId] = clanId;
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const createResponse = `🎉 Clan "${clanName}" créé !\n🆔 ID: **${clanId}**\n👑 Tu es le chef\n💰 100 pièces • ⭐ Niveau 1\n⚔️ 10 guerriers, 5 archers, 2 mages\n💾 Sauvegardé automatiquement !`;
            addToMemory(userId, 'assistant', createResponse);
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return createResponse;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan ! `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ Protégé ' : '';
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}**\n🆔 ${clan.id} • ⭐ Niv.${clan.level}\n👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n✨ XP: ${clan.xp} (${nextXP} pour +1)\n⚔️ ${clan.units.w}g ${clan.units.a}a ${clan.units.m}m\n${protection}`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Seul le chef peut inviter !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ Usage: `/clan invite @utilisateur`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Clan plein ! (20 max)";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (data.userClans[targetUser]) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne a déjà un clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Déjà invité !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const inviteResponse = `📨 ${args_parts[1]} invité dans **${inviterClan.name}** !\nIl peut rejoindre avec: \`/clan join ${inviterClan.id}\``;
            addToMemory(userId, 'assistant', inviteResponse);
            return inviteResponse;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    addToMemory(userId, 'user', `/clan ${args}`);
                    const response = "❌ Aucune invitation ! Usage: `/clan join [id]`";
                    addToMemory(userId, 'assistant', response);
                    return response;
                }
                
                let inviteList = "📬 **TES INVITATIONS**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        inviteList += `${i+1}. **${c.name}** (${clanId})\n   👥 ${c.members.length}/20 • ⭐ Niv.${c.level}\n\n`;
                    }
                });
                inviteList += "Pour rejoindre: `/clan join [id]`";
                
                addToMemory(userId, 'user', `/clan ${args}`);
                addToMemory(userId, 'assistant', inviteList);
                return inviteList;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu as déjà un clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const joinClan = findClan(joinArg);
            if (!joinClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Clan introuvable !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[userId]?.includes(joinClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'es pas invité dans ce clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (joinClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Clan plein !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Rejoindre
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const joinResponse = `🎉 Tu as rejoint **${joinClan.name}** !\n🆔 ${joinClan.id} • 👥 ${joinClan.members.length}/20`;
            addToMemory(userId, 'assistant', joinResponse);
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return joinResponse;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isLeader() && leaveClan.members.length > 1) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Promeus un nouveau chef d'abord ! `/clan promote @membre`";
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
                await save(); // ✅ CORRECTION: Sauvegarde asynchrone
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const dissolveResponse = `💥 Clan "${clanName}" dissous !\n⏰ Tu pourras en créer un nouveau dans 3 jours.`;
                addToMemory(userId, 'assistant', dissolveResponse);
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return dissolveResponse;
            } else {
                // Quitter seulement
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save(); // ✅ CORRECTION: Sauvegarde asynchrone
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const leaveResponse = `👋 Tu as quitté "${leaveClan.name}".`;
                addToMemory(userId, 'assistant', leaveResponse);
                return leaveResponse;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyArg = args_parts[1];
            if (!enemyArg) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ Usage: `/clan battle [id ou nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Clan ennemi introuvable !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (enemyClan.id === attackerClan.id) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu ne peux pas t'attaquer toi-même !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isProtected(enemyClan)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `🛡️ ${enemyClan.name} est protégé !`;
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
            
            // ✅ AJOUT: Historique des batailles
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
            
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            // Notifier le défenseur
            if (enemyClan.members[0] !== userId) {
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, victory);
            }
            
            let battleResult = `⚔️ **${attackerClan.name} VS ${enemyClan.name}**\n\n`;
            if (victory) {
                battleResult += `🏆 **VICTOIRE !**\n✨ +${xpGain} XP | 💰 +${goldChange}\n${levelUp ? '🆙 NIVEAU UP !\n' : ''}💀 Pertes: ${myLosses} unités\n💾 Bataille sauvegardée !`;
            } else {
                battleResult += `🛡️ **DÉFAITE...**\n✨ +${xpGain} XP | 💰 ${goldChange}\n💀 Pertes: ${myLosses} unités\n🛡️ Protégé 2h\n💾 Bataille sauvegardée !`;
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
                const response = "❌ Aucun clan ! Crée le premier avec `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let list = "🏆 **TOP CLANS**\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '';
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}\n   ⭐ Niv.${clan.level} • 👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n\n`;
            });
            
            list += `💾 Total: ${Object.keys(data.clans).length} clans sauvegardés`;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', list);
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const unitsResponse = `⚔️ **UNITÉS DE ${unitsClan.name}**\n\n🗡️ Guerriers: ${unitsClan.units.w}\n🏹 Archers: ${unitsClan.units.a}\n🔮 Mages: ${unitsClan.units.m}\n\n💰 Trésorerie: ${unitsClan.treasury}\n\nAcheter: \`/clan units [type] [nombre]\`\nPrix: Guerrier 40💰 | Archer 60💰 | Mage 80💰`;
                addToMemory(userId, 'assistant', unitsResponse);
                return unitsResponse;
            }
            
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Seul le chef peut acheter des unités !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let cost = 0;
            let unitKey = '';
            
            if (['guerrier', 'g', 'warrior'].includes(unitType)) {
                cost = 40 * quantity;
                unitKey = 'w';
            } else if (['archer', 'a'].includes(unitType)) {
                cost = 60 * quantity;
                unitKey = 'a';
            } else if (['mage', 'm'].includes(unitType)) {
                cost = 80 * quantity;
                unitKey = 'm';
            } else {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Type invalide ! Utilise: guerrier, archer, ou mage";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (unitsClan.treasury < cost) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ Fonds insuffisants ! Coût: ${cost}💰, Dispo: ${unitsClan.treasury}💰`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const buyResponse = `✅ ${quantity} ${unitType}(s) acheté(s) pour ${cost}💰 !\n💰 Reste: ${unitsClan.treasury}💰\n💾 Sauvegardé !`;
            addToMemory(userId, 'assistant', buyResponse);
            return buyResponse;

        case 'promote':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Seul le chef peut promouvoir !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ Usage: `/clan promote @nouveau_chef`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne n'est pas dans ton clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            promoteClan.leader = newLeader;
            await save(); // ✅ CORRECTION: Sauvegarde asynchrone
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const promoteResponse = `👑 ${args_parts[1]} est le nouveau chef de **${promoteClan.name}** !\n💾 Sauvegardé !`;
            addToMemory(userId, 'assistant', promoteResponse);
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return promoteResponse;

        case 'stats':
            // ✅ AJOUT: Statistiques des clans
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
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const statsResponse = `📊 **STATISTIQUES CLANS**\n\n🏰 Total clans: ${totalClans}\n👥 Total membres: ${totalMembers}\n⚔️ Total batailles: ${totalBattles}\n📈 Niveau moyen: ${averageLevel}\n💾 Sauvegardé sur GitHub\n\n🔝 Clan le plus fort: ${topClans[0]?.name || 'Aucun'}\n📅 Dernière mise à jour: ${new Date().toLocaleString()}`;
            addToMemory(userId, 'assistant', statsResponse);
            return statsResponse;

        case 'help':
            addToMemory(userId, 'user', `/clan ${args}`);
            const helpResponse = `⚔️ **COMMANDES CLAN**\n\n🏰 **Base:**\n• \`/clan create [nom]\` - Créer\n• \`/clan info\` - Tes infos\n• \`/clan list\` - Top clans\n\n👥 **Membres:**\n• \`/clan invite @user\` - Inviter\n• \`/clan join [id]\` - Rejoindre\n• \`/clan leave\` - Quitter/dissoudre\n• \`/clan promote @user\` - Nouveau chef\n\n⚔️ **Combat:**\n• \`/clan battle [id]\` - Attaquer\n• \`/clan units\` - Voir/acheter unités\n\n💾 **Toutes tes données sont sauvegardées automatiquement sur GitHub !**\n💎 **Les IDs sont courts et faciles à retenir !**`;
            addToMemory(userId, 'assistant', helpResponse);
            return helpResponse;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ Protégé' : '';
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `🏰 **${userClan.name}** (${userClan.id})\n⭐ Niv.${userClan.level} • 👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury} ${protection}\n\nTape \`/clan help\` pour toutes les options !\n💾 Données sauvegardées automatiquement`;
                addToMemory(userId, 'assistant', response);
                return response;
            } else {
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `⚔️ **SYSTÈME DE CLANS**\n\nTu n'as pas de clan !\n\n🏰 \`/clan create [nom]\` - Créer ton clan\n📜 \`/clan list\` - Voir tous les clans\n❓ \`/clan help\` - Aide complète\n\n💾 **Toutes les données sont sauvegardées automatiquement sur GitHub !**`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
    }
};
