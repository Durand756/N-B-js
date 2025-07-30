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
                const response = "⚔️ **Créer un clan**\n\nUsage: `/clan create [nom]`\nExemple: `/clan create Dragons` 🐉\n\n💡 *Le nom de ton clan sera visible par tous les autres joueurs*";
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
            const createResponse = `🎉 **Clan créé avec succès !**\n\n🏰 **${clanName}**\n🆔 ID: **${clanId}**\n👑 Tu es le chef de ce clan\n💰 100 pièces d'or\n⭐ Niveau 1\n⚔️ 10 guerriers, 5 archers, 2 mages\n\n💡 *Utilise \`/clan help\` pour découvrir toutes les possibilités !*`;
            addToMemory(userId, 'assistant', createResponse);
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return createResponse;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 Utilise `/clan create [nom]` pour créer ton clan\n📜 Ou `/clan list` pour voir les clans existants";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ Protégé (2h) ' : '';
            const isChief = isLeader() ? '👑 Chef' : '👤 Membre';
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}**\n🆔 ${clan.id} • ${isChief}\n⭐ Niveau ${clan.level} • 👥 ${clan.members.length}/20 membres\n💰 ${clan.treasury} pièces d'or\n✨ XP: ${clan.xp} (${nextXP} pour niveau suivant)\n⚔️ Armée: ${clan.units.w} guerriers, ${clan.units.a} archers, ${clan.units.m} mages\n${protection}`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Seul le chef du clan peut inviter de nouveaux membres !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Inviter un membre**\n\nUsage: `/clan invite @utilisateur`\nExemple: `/clan invite @John`\n\n💡 *L'utilisateur recevra une invitation qu'il pourra accepter*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Ton clan est plein ! (maximum 20 membres)\n\n💡 *Tu peux exclure des membres inactifs si tu es le chef*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (data.userClans[targetUser]) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne fait déjà partie d'un clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu as déjà invité cette personne !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const inviteResponse = `📨 **Invitation envoyée !**\n\n${args_parts[1]} a été invité à rejoindre **${inviterClan.name}**\n\n💡 *Il peut rejoindre avec: \`/clan join ${inviterClan.id}\`*`;
            addToMemory(userId, 'assistant', inviteResponse);
            return inviteResponse;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    addToMemory(userId, 'user', `/clan ${args}`);
                    const response = "❌ **Aucune invitation**\n\nTu n'as reçu aucune invitation de clan.\n\n💡 *Les chefs de clan peuvent t'inviter avec \`/clan invite @tonnom\`*\n📜 *Ou regarde les clans disponibles avec \`/clan list\`*";
                    addToMemory(userId, 'assistant', response);
                    return response;
                }
                
                let inviteList = "📬 **TES INVITATIONS**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        inviteList += `${i+1}. **${c.name}** (${clanId})\n   👥 ${c.members.length}/20 membres • ⭐ Niveau ${c.level}\n   👑 Chef: ${c.leader}\n\n`;
                    }
                });
                inviteList += "💡 *Pour rejoindre: \`/clan join [id]\`*";
                
                addToMemory(userId, 'user', `/clan ${args}`);
                addToMemory(userId, 'assistant', inviteList);
                return inviteList;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu fais déjà partie d'un clan !\n\n💡 *Utilise \`/clan leave\` pour quitter ton clan actuel*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const joinClan = findClan(joinArg);
            if (!joinClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan introuvable**\n\nAucun clan trouvé avec cet ID ou nom.\n\n💡 *Vérifie l'orthographe ou utilise \`/clan join\` pour voir tes invitations*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[userId]?.includes(joinClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Pas d'invitation**\n\nTu n'as pas été invité dans le clan **${joinClan.name}**.\n\n💡 *Demande au chef ${joinClan.leader} de t'inviter*`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (joinClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Clan plein**\n\nLe clan **${joinClan.name}** a atteint sa capacité maximale (20 membres).`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Rejoindre
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const joinResponse = `🎉 **Bienvenue dans le clan !**\n\nTu as rejoint **${joinClan.name}** !\n🆔 ${joinClan.id} • 👥 ${joinClan.members.length}/20 membres\n⭐ Niveau ${joinClan.level}\n\n💡 *Utilise \`/clan info\` pour voir les détails du clan*`;
            addToMemory(userId, 'assistant', joinResponse);
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return joinResponse;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu ne fais partie d'aucun clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isLeader() && leaveClan.members.length > 1) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Chef responsable**\n\nTu es le chef et il y a d'autres membres !\n\n💡 *Promeus un nouveau chef avec \`/clan promote @membre\`*\n💡 *Ou utilise \`/clan dissolve\` pour dissoudre le clan*";
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
                const dissolveResponse = `💥 **Clan dissous**\n\nLe clan "${clanName}" a été dissous.\n⏰ Tu pourras créer un nouveau clan dans 3 jours.\n\n💡 *Cette période d'attente évite les abus*`;
                addToMemory(userId, 'assistant', dissolveResponse);
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return dissolveResponse;
            } else {
                // Quitter seulement
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const leaveResponse = `👋 **Clan quitté**\n\nTu as quitté le clan "${leaveClan.name}".\n\n💡 *Tu peux maintenant rejoindre un autre clan ou en créer un*`;
                addToMemory(userId, 'assistant', leaveResponse);
                return leaveResponse;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan pour attaquer !\n\n🏰 Crée ou rejoins un clan d'abord";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyArg = args_parts[1];
            if (!enemyArg) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Attaquer un clan**\n\nUsage: `/clan battle [id ou nom]`\nExemple: `/clan battle ABCD` ou `/clan battle Dragons`\n\n💡 *Tu peux voir les clans disponibles avec \`/clan list\`*\n💡 *Les clans protégés (🛡️) ne peuvent pas être attaqués*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan ennemi introuvable**\n\nAucun clan trouvé avec cet ID ou nom.\n\n💡 *Utilise \`/clan list\` pour voir tous les clans*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (enemyClan.id === attackerClan.id) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu ne peux pas attaquer ton propre clan ! 😅";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isProtected(enemyClan)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `🛡️ **Clan protégé**\n\n**${enemyClan.name}** est protégé après une récente défaite.\n\n💡 *Les clans sont protégés 2h après une défaite*`;
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
            
            let battleResult = `⚔️ **BATAILLE : ${attackerClan.name} VS ${enemyClan.name}**\n\n`;
            if (victory) {
                battleResult += `🏆 **VICTOIRE !**\n✨ +${xpGain} XP • 💰 +${goldChange} pièces\n${levelUp ? '🆙 **NIVEAU UP !**\n' : ''}💀 Pertes au combat: ${myLosses} unités\n\n💡 *Continue à attaquer pour progresser !*`;
            } else {
                battleResult += `🛡️ **DÉFAITE...**\n✨ +${xpGain} XP • 💰 ${goldChange} pièces\n💀 Pertes au combat: ${myLosses} unités\n🛡️ Ton clan est protégé 2h\n\n💡 *Renforce ton armée avec \`/clan units\` !*`;
            }
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', battleResult);
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${victory ? 'Victoire attaquant' : 'Victoire défenseur'}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans)
                .sort((a, b) => b.level - a.level || b.xp - a.xp)
                .slice(0, 15);
            
            if (topClans.length === 0) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Aucun clan existant**\n\nSois le premier à créer un clan !\n\n🏰 `/clan create [nom]` pour commencer\n💡 *Exemple: `/clan create Guerriers`*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let list = "🏆 **CLASSEMENT DES CLANS**\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '';
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}\n   ⭐ Niveau ${clan.level} • 👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n\n`;
            });
            
            list += `💡 *Total: ${Object.keys(data.clans).length} clans • Utilise \`/clan battle [id]\` pour attaquer*`;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', list);
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 Crée ou rejoins un clan d'abord";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                const totalPower = calculatePower(unitsClan);
                addToMemory(userId, 'user', `/clan ${args}`);
                const unitsResponse = `⚔️ **ARMÉE DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w}\n   • Coût: 40💰 chacun\n   • Puissance de base: 10\n\n🏹 **Archers:** ${unitsClan.units.a}\n   • Coût: 60💰 chacun\n   • Puissance de base: 8\n\n🔮 **Mages:** ${unitsClan.units.m}\n   • Coût: 80💰 chacun\n   • Puissance de base: 15\n\n💰 **Trésorerie:** ${unitsClan.treasury} pièces\n⚡ **Puissance totale:** ~${Math.round(totalPower)}\n\n💡 **Acheter:** \`/clan units [type] [nombre]\`\n💡 **Exemples:** \`/clan units guerrier 5\` ou \`/clan units mage 2\``;
                addToMemory(userId, 'assistant', unitsResponse);
                return unitsResponse;
            }
            
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Réservé au chef**\n\nSeul le chef du clan peut acheter des unités.\n\n💡 *Demande à ton chef d'investir dans l'armée !*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let cost = 0;
            let unitKey = '';
            let unitName = '';
            
            if (['guerrier', 'g', 'warrior', 'guerriers'].includes(unitType)) {
                cost = 40 * quantity;
                unitKey = 'w';
                unitName = 'guerrier';
            } else if (['archer', 'a', 'archers'].includes(unitType)) {
                cost = 60 * quantity;
                unitKey = 'a';
                unitName = 'archer';
            } else if (['mage', 'm', 'mages'].includes(unitType)) {
                cost = 80 * quantity;
                unitKey = 'm';
                unitName = 'mage';
            } else {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Type d'unité invalide**\n\nTypes disponibles:\n• `guerrier` ou `g`\n• `archer` ou `a`\n• `mage` ou `m`\n\n💡 *Exemple: `/clan units guerrier 5`*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (unitsClan.treasury < cost) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Fonds insuffisants**\n\nCoût: ${cost}💰\nDisponible: ${unitsClan.treasury}💰\nManque: ${cost - unitsClan.treasury}💰\n\n💡 *Gagne de l'or en remportant des batailles !*`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const buyResponse = `✅ **Achat réussi !**\n\n🎖️ ${quantity} ${unitName}${quantity > 1 ? 's' : ''} recruté${quantity > 1 ? 's' : ''}\n💰 Coût: ${cost} pièces\n💰 Reste: ${unitsClan.treasury} pièces\n\n⚡ *Votre armée est maintenant plus puissante !*`;
            addToMemory(userId, 'assistant', buyResponse);
            return buyResponse;

        case 'promote':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Réservé au chef**\n\nSeul le chef actuel peut promouvoir un membre.\n\n💡 *Cette action transfère le leadership du clan*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **Promouvoir un chef**\n\nUsage: `/clan promote @nouveau_chef`\nExemple: `/clan promote @John`\n\n⚠️ *Tu perdras ton statut de chef !*\n💡 *Choisis un membre actif et de confiance*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Membre introuvable**\n\nCette personne ne fait pas partie de ton clan.\n\n👥 *Vérifie avec `/clan info` la liste des membres*";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (newLeader === userId) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu es déjà le chef ! 😅";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            promoteClan.leader = newLeader;
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const promoteResponse = `👑 **Nouveau chef nommé !**\n\n${args_parts[1]} est maintenant le chef de **${promoteClan.name}**\n\n💡 *Tu es maintenant membre du clan*\n💡 *Le nouveau chef a tous les pouvoirs de gestion*`;
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
            const topClans = Object.values(data.clans).sort((a, b) => b.level - a.level || b.xp - a.xp);
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const statsResponse = `📊 **STATISTIQUES ADMINISTRATEUR**\n\n🏰 **Clans totaux:** ${totalClans}\n👥 **Membres totaux:** ${totalMembers}\n⚔️ **Batailles totales:** ${totalBattles}\n📈 **Niveau moyen:** ${averageLevel}\n\n🔝 **Clan le plus fort:** ${topClans[0]?.name || 'Aucun'}\n📅 **Dernière MAJ:** ${new Date().toLocaleString()}\n\n💾 **Système opérationnel**`;
            addToMemory(userId, 'assistant', statsResponse);
            return statsResponse;

        case 'help':
            addToMemory(userId, 'user', `/clan ${args}`);
            const helpResponse = `⚔️ **GUIDE COMPLET DES CLANS**\n\n🏰 **GESTION DE BASE**\n• \`/clan create [nom]\` - Créer un nouveau clan\n• \`/clan info\` - Voir les détails de ton clan\n• \`/clan list\` - Classement de tous les clans\n• \`/clan leave\` - Quitter ton clan\n\n👥 **GESTION DES MEMBRES**\n• \`/clan invite @user\` - Inviter quelqu'un (chef uniquement)\n• \`/clan join [id]\` - Rejoindre un clan sur invitation\n• \`/clan promote @user\` - Nommer un nouveau chef (chef uniquement)\n\n⚔️ **COMBAT ET STRATÉGIE**\n• \`/clan battle [id/nom]\` - Attaquer un autre clan\n• \`/clan units\` - Voir ton armée\n• \`/clan units [type] [nombre]\` - Acheter des unités (chef uniquement)\n\n💡 **CONSEILS POUR DÉBUTER**\n1️⃣ Crée ton clan ou rejoins-en un existant\n2️⃣ Recrute des membres pour être plus fort\n3️⃣ Achète des unités avec l'or du clan\n4️⃣ Attaque d'autres clans pour gagner XP et or\n5️⃣ Protège-toi après une défaite (2h de protection)\n\n🎯 **OBJECTIFS**\n• Montez de niveau en gagnant de l'XP\n• Accumulez de l'or pour votre armée\n• Dominez le classement des clans !\n\n🛡️ **RÈGLES IMPORTANTES**\n• Maximum 20 membres par clan\n• Protection de 2h après une défaite\n• Cooldown de 3 jours pour recréer un clan\n• Seuls les chefs peuvent inviter et acheter des unités`;
            addToMemory(userId, 'assistant', helpResponse);
            return helpResponse;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ Protégé' : '';
                const isChief = isLeader() ? '👑 Chef' : '👤 Membre';
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `🏰 **${userClan.name}** (${userClan.id})\n${isChief} • ⭐ Niveau ${userClan.level}\n👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury} ${protection}\n\n💡 *Utilise \`/clan help\` pour voir toutes les commandes disponibles !*`;
                addToMemory(userId, 'assistant', response);
                return response;
            } else {
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `⚔️ **BIENVENUE DANS LE SYSTÈME DE CLANS !**\n\n🎯 **Tu n'as pas encore de clan**\n\n🚀 **POUR COMMENCER :**\n🏰 \`/clan create [nom]\` - Créer ton propre clan\n📜 \`/clan list\` - Voir les clans existants\n📨 \`/clan join\` - Voir tes invitations\n\n❓ **BESOIN D'AIDE ?**\n💡 \`/clan help\` - Guide complet et détaillé\n\n🌟 **POURQUOI REJOINDRE UN CLAN ?**\n• Combat contre d'autres clans\n• Progression en équipe\n• Gestion d'armée et de ressources\n• Classements et compétition\n\n🎮 *Commence dès maintenant ton aventure de clan !*`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
    }
};
