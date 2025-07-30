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
    
    // Utiliser le nouveau système de sauvegarde
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
    
    // Sauvegarde des données
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
                const response = "⚔️ **CRÉER UN CLAN** 🏰\n\nUsage: `/clan create [nom]`\nExemple: `/clan create Dragons`\n\n📝 Le nom doit être unique et peut contenir des espaces";
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
                const response = `❌ Tu as supprimé un clan récemment !\n⏰ Attends encore **${timeLeft}** pour en créer un nouveau.`;
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
            const createResponse = `🎉 **Clan "${clanName}" créé avec succès !**\n\n🆔 **ID du clan:** ${clanId}\n👑 **Chef:** Toi\n💰 **Trésorerie:** 100 pièces d'or\n⭐ **Niveau:** 1\n⚔️ **Armée:** 10 guerriers, 5 archers, 2 mages\n\n💡 **Prochaines étapes:**\n• Invite des amis avec \`/clan invite @ami\`\n• Attaque d'autres clans avec \`/clan battle [id]\`\n• Achète des unités avec \`/clan units\``;
            addToMemory(userId, 'assistant', createResponse);
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return createResponse;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 **Créer un clan:** `/clan create [nom]`\n📜 **Voir tous les clans:** `/clan list`\n❓ **Aide complète:** `/clan help`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '\n🛡️ **Protégé contre les attaques** (2h après défaite)' : '';
            const isChef = isLeader() ? ' 👑' : '';
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}** (${clan.id})${isChef}\n\n📊 **Statistiques:**\n⭐ Niveau ${clan.level}\n👥 ${clan.members.length}/20 membres\n💰 ${clan.treasury} pièces d'or\n✨ ${clan.xp} XP (${nextXP} pour niveau suivant)\n\n⚔️ **Armée:**\n🗡️ ${clan.units.w} guerriers\n🏹 ${clan.units.a} archers\n🔮 ${clan.units.m} mages${protection}`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef peut inviter des membres !**\n\n👑 Tu dois être le chef du clan pour utiliser cette commande.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "👥 **INVITER UN MEMBRE** 📨\n\nUsage: `/clan invite @utilisateur`\nExemple: `/clan invite @ami`\n\n📝 La personne recevra une invitation qu'elle pourra accepter avec `/clan join [id]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan complet !** 👥\n\nTon clan a atteint la limite de 20 membres maximum.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (data.userClans[targetUser]) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne appartient déjà à un clan !\n\n💡 Elle doit d'abord quitter son clan actuel avec `/clan leave`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Cette personne a déjà été invitée dans ton clan !";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const inviteResponse = `📨 **Invitation envoyée !**\n\n${args_parts[1]} a été invité(e) dans **${inviterClan.name}**\n\n💡 **Instructions pour la personne invitée:**\n• Voir ses invitations: \`/clan join\`\n• Rejoindre directement: \`/clan join ${inviterClan.id}\``;
            addToMemory(userId, 'assistant', inviteResponse);
            return inviteResponse;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    addToMemory(userId, 'user', `/clan ${args}`);
                    const response = "📭 **AUCUNE INVITATION**\n\nTu n'as reçu aucune invitation de clan.\n\n💡 **Comment rejoindre un clan:**\n• Demande à un chef de clan de t'inviter\n• Utilise \`/clan list\` pour voir les clans existants\n• Utilise \`/clan join [id]\` si tu connais l'ID d'un clan";
                    addToMemory(userId, 'assistant', response);
                    return response;
                }
                
                let inviteList = "📬 **TES INVITATIONS DE CLAN**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        inviteList += `**${i+1}. ${c.name}** (${clanId})\n   👑 Chef: ${c.leader}\n   👥 ${c.members.length}/20 membres\n   ⭐ Niveau ${c.level}\n\n`;
                    }
                });
                inviteList += "💡 **Pour rejoindre:** `/clan join [id]`\nExemple: `/clan join " + myInvites[0] + "`";
                
                addToMemory(userId, 'user', `/clan ${args}`);
                addToMemory(userId, 'assistant', inviteList);
                return inviteList;
            }
            
            if (getUserClan()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu appartiens déjà à un clan !\n\n💡 Utilise `/clan leave` pour quitter ton clan actuel d'abord.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const joinClan = findClan(joinArg);
            if (!joinClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan introuvable !**\n\n💡 Vérife l'ID ou le nom du clan.\nUtilise `/clan list` pour voir tous les clans disponibles.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!data.invites[userId]?.includes(joinClan.id)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Invitation requise !**\n\nTu n'as pas été invité(e) dans le clan **${joinClan.name}**.\n\n💡 Demande au chef de ce clan de t'inviter avec \`/clan invite @toi\``;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (joinClan.members.length >= 20) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Clan complet !**\n\nLe clan **${joinClan.name}** a atteint sa limite de 20 membres.`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            // Rejoindre le clan
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const joinResponse = `🎉 **Bienvenue dans ${joinClan.name} !**\n\n🆔 **ID du clan:** ${joinClan.id}\n👥 **Membres:** ${joinClan.members.length}/20\n⭐ **Niveau:** ${joinClan.level}\n💰 **Trésorerie:** ${joinClan.treasury} pièces d'or\n\n💡 **Commandes utiles:**\n• Voir les infos: \`/clan info\`\n• Participer aux batailles: \`/clan battle [ennemi]\``;
            addToMemory(userId, 'assistant', joinResponse);
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return joinResponse;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'appartiens à aucun clan !\n\n🏰 **Créer un clan:** `/clan create [nom]`\n📜 **Rejoindre un clan:** `/clan list` puis demander une invitation";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (isLeader() && leaveClan.members.length > 1) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Tu es le chef !**\n\nAvant de quitter, tu dois soit:\n👑 **Promouvoir un nouveau chef:** \`/clan promote @membre\`\n💥 **Ou dissoudre le clan** (tous les membres seront éjectés)\n\n⚠️ Si tu quittes maintenant, le clan sera automatiquement dissous !`;
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
                const dissolveResponse = `💥 **Clan "${clanName}" dissous !**\n\n⏰ **Cooldown:** Tu pourras créer un nouveau clan dans 3 jours.\n\n💡 Les autres membres ont été automatiquement éjectés et peuvent rejoindre d'autres clans.`;
                addToMemory(userId, 'assistant', dissolveResponse);
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return dissolveResponse;
            } else {
                // Quitter seulement
                const clanName = leaveClan.name;
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                
                addToMemory(userId, 'user', `/clan ${args}`);
                const leaveResponse = `👋 **Tu as quitté "${clanName}"**\n\n🏰 Tu peux maintenant créer un nouveau clan ou rejoindre un autre clan.\n\n💡 **Prochaines étapes:**\n• Créer un clan: \`/clan create [nom]\`\n• Voir les clans: \`/clan list\``;
                addToMemory(userId, 'assistant', leaveResponse);
                return leaveResponse;
            }

        case 'battle':
        case 'attack':
            const attackerClan = getUserClan();
            if (!attackerClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan pour combattre !\n\n🏰 **Créer un clan:** `/clan create [nom]`\n📜 **Rejoindre un clan:** `/clan list` puis demander une invitation";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyArg = args_parts[1];
            if (!enemyArg) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "⚔️ **ATTAQUER UN CLAN** 💥\n\nUsage: `/clan battle [id ou nom]`\nExemples:\n• `/clan battle ABCD` (par ID)\n• `/clan battle Dragons` (par nom)\n\n💡 **Conseils:**\n• Utilise `/clan list` pour voir les clans\n• Les clans protégés 🛡️ ne peuvent pas être attaqués\n• Tu gagnes de l'XP et de l'or en cas de victoire";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Clan ennemi introuvable !**\n\n💡 Vérife l'ID ou le nom du clan.\nUtilise `/clan list` pour voir tous les clans disponibles.";
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
                const response = `🛡️ **${enemyClan.name} est protégé !**\n\nCe clan a subi une défaite récente et bénéficie d'une protection de 2 heures.\n\n💡 Attaque un autre clan ou attends que la protection expire.`;
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
            
            // Appliquer les changements
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
            
            let battleResult = `⚔️ **BATAILLE ÉPIQUE !**\n**${attackerClan.name} VS ${enemyClan.name}**\n\n`;
            if (victory) {
                battleResult += `🏆 **VICTOIRE ÉCRASANTE !**\n\n📈 **Gains:**\n✨ +${xpGain} XP\n💰 +${goldChange} pièces d'or${levelUp ? '\n🆙 **NIVEAU UP !**' : ''}\n\n💀 **Pertes:** ${myLosses} unités\n🛡️ **L'ennemi est maintenant protégé 2h**`;
            } else {
                battleResult += `🛡️ **DÉFAITE HONORABLE...**\n\n📈 **Gains:**\n✨ +${xpGain} XP (expérience de combat)\n💰 ${goldChange} pièces d'or\n\n💀 **Pertes:** ${myLosses} unités\n🛡️ **Tu es maintenant protégé 2h**`;
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
                const response = "🏜️ **AUCUN CLAN EXISTANT**\n\nSois le premier à créer un clan !\n\n🏰 **Créer un clan:** `/clan create [nom]`\nExemple: `/clan create Chevaliers`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let list = "🏆 **CLASSEMENT DES CLANS**\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i+1}.**`;
                const protection = isProtected(clan) ? ' 🛡️' : '';
                list += `${medal} **${clan.name}** (${clan.id})${protection}\n`;
                list += `   ⭐ Niveau ${clan.level} • 👥 ${clan.members.length}/20 • 💰 ${clan.treasury}\n\n`;
            });
            
            const userClan = getUserClan();
            if (userClan) {
                const userRank = topClans.findIndex(c => c.id === userClan.id);
                if (userRank !== -1) {
                    list += `\n👤 **Ton clan:** ${userRank + 1}ème position`;
                } else {
                    list += `\n👤 **Ton clan:** Pas dans le top 10`;
                }
            }
            
            list += `\n\n💡 **Total:** ${Object.keys(data.clans).length} clans actifs`;
            list += `\n🛡️ = Protégé contre les attaques`;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            addToMemory(userId, 'assistant', list);
            return list;

        case 'units':
        case 'army':
            const unitsClan = getUserClan();
            if (!unitsClan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 **Créer un clan:** `/clan create [nom]`\n📜 **Rejoindre un clan:** `/clan list` puis demander une invitation";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const unitsResponse = `⚔️ **ARMÉE DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w}\n   • Force: 10 points chacun\n   • Prix: 40💰 chacun\n\n🏹 **Archers:** ${unitsClan.units.a}\n   • Force: 8 points chacun\n   • Prix: 60💰 chacun\n\n🔮 **Mages:** ${unitsClan.units.m}\n   • Force: 15 points chacun\n   • Prix: 80💰 chacun\n\n💰 **Trésorerie:** ${unitsClan.treasury} pièces d'or\n\n💡 **Acheter des unités:**\n\`/clan units guerrier [nombre]\`\n\`/clan units archer [nombre]\`\n\`/clan units mage [nombre]\`\n\nExemple: \`/clan units guerrier 5\``;
                addToMemory(userId, 'assistant', unitsResponse);
                return unitsResponse;
            }
            
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef peut acheter des unités !**\n\n👑 Tu dois être le chef du clan pour gérer l'armée.\n\n💡 Voir l'armée actuelle: `/clan units`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            let cost = 0;
            let unitKey = '';
            let unitName = '';
            
            if (['guerrier', 'g', 'warrior', 'w'].includes(unitType)) {
                cost = 40 * quantity;
                unitKey = 'w';
                unitName = 'guerrier';
            } else if (['archer', 'a'].includes(unitType)) {
                cost = 60 * quantity;
                unitKey = 'a';
                unitName = 'archer';
            } else if (['mage', 'm', 'magicien'].includes(unitType)) {
                cost = 80 * quantity;
                unitKey = 'm';
                unitName = 'mage';
            } else {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Type d'unité invalide !**\n\n✅ **Types disponibles:**\n🗡️ **guerrier** (ou g, warrior, w)\n🏹 **archer** (ou a)\n🔮 **mage** (ou m, magicien)\n\nExemple: `/clan units guerrier 3`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (unitsClan.treasury < cost) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Fonds insuffisants !**\n\n💰 **Coût total:** ${cost} pièces d'or\n💰 **Disponible:** ${unitsClan.treasury} pièces d'or\n💰 **Manque:** ${cost - unitsClan.treasury} pièces d'or\n\n💡 Gagne de l'or en remportant des batailles !`;
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            const plural = quantity > 1 ? 's' : '';
            addToMemory(userId, 'user', `/clan ${args}`);
            const buyResponse = `✅ **Achat réussi !**\n\n🛒 **Acheté:** ${quantity} ${unitName}${plural}\n💰 **Coût:** ${cost} pièces d'or\n💰 **Reste:** ${unitsClan.treasury} pièces d'or\n\n⚔️ **Nouvelle armée:**\n🗡️ ${unitsClan.units.w} guerriers\n🏹 ${unitsClan.units.a} archers\n🔮 ${unitsClan.units.m} mages\n\n💡 Plus d'unités = plus de force au combat !`;
            addToMemory(userId, 'assistant', buyResponse);
            return buyResponse;

        case 'promote':
            if (!isLeader()) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **Seul le chef peut promouvoir !**\n\n👑 Tu dois être le chef du clan pour utiliser cette commande.";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "👑 **PROMOUVOIR UN NOUVEAU CHEF**\n\nUsage: `/clan promote @membre`\nExemple: `/clan promote @ami`\n\n⚠️ **Attention:** Tu perdras ton statut de chef !\nLe nouveau chef aura tous les pouvoirs:\n• Inviter/expulser des membres\n• Acheter des unités\n• Gérer la trésorerie";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = `❌ **Membre introuvable !**\n\nCette personne n'est pas membre de ton clan **${promoteClan.name}**.\n\n💡 **Membres actuels:** ${promoteClan.members.length}/20\nUtilise `/clan info` pour voir les détails du clan.`;
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
            const promoteResponse = `👑 **NOUVEAU CHEF NOMMÉ !**\n\n${args_parts[1]} est maintenant le chef de **${promoteClan.name}** !\n\n📋 **Pouvoirs transférés:**\n• Gestion des membres\n• Achat d'unités\n• Gestion de la trésorerie\n• Lancement des batailles\n\n💡 Tu restes membre du clan mais n'es plus chef.`;
            addToMemory(userId, 'assistant', promoteResponse);
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return promoteResponse;

        case 'stats':
            // Statistiques des clans (admin seulement)
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
            const statsResponse = `📊 **STATISTIQUES GLOBALES DES CLANS**\n\n🏰 **Total clans:** ${totalClans}\n👥 **Total membres:** ${totalMembers}\n⚔️ **Total batailles:** ${totalBattles}\n📈 **Niveau moyen:** ${averageLevel}\n\n🔝 **Clan le plus fort:** ${topClans[0]?.name || 'Aucun'}\n📅 **Dernière mise à jour:** ${new Date().toLocaleString()}\n\n💾 **Système opérationnel**`;
            addToMemory(userId, 'assistant', statsResponse);
            return statsResponse;

        case 'help':
        case 'aide':
            addToMemory(userId, 'user', `/clan ${args}`);
            const helpResponse = `⚔️ **GUIDE COMPLET DES CLANS** 🏰\n\n**🏗️ CRÉATION & GESTION**\n• \`/clan create [nom]\` - Créer un nouveau clan\n• \`/clan info\` - Voir les infos de ton clan\n• \`/clan leave\` - Quitter/dissoudre ton clan\n\n**👥 MEMBRES**\n• \`/clan invite @user\` - Inviter quelqu'un (chef seulement)\n• \`/clan join [id]\` - Rejoindre un clan ou voir tes invitations\n• \`/clan promote @user\` - Nommer un nouveau chef (chef seulement)\n\n**⚔️ COMBAT & ARMÉE**\n• \`/clan battle [id/nom]\` - Attaquer un autre clan\n• \`/clan units\` - Voir ton armée et les prix\n• \`/clan units [type] [nombre]\` - Acheter des unités (chef seulement)\n\n**📊 EXPLORATION**\n• \`/clan list\` - Voir le classement des clans\n• \`/clan help\` - Ce guide d'aide\n\n**💡 CONSEILS POUR DÉBUTER**\n1️⃣ Crée ton clan avec un nom unique\n2️⃣ Invite des amis pour grossir ton clan\n3️⃣ Achète des unités pour renforcer ton armée\n4️⃣ Attaque d'autres clans pour gagner XP et or\n5️⃣ Monte de niveau pour devenir le clan le plus fort !\n\n**🛡️ RÈGLES IMPORTANTES**\n• Maximum 20 membres par clan\n• Protection de 2h après une défaite\n• Cooldown de 3 jours après dissolution d'un clan\n• Seul le chef peut inviter, acheter des unités et promouvoir`;
            addToMemory(userId, 'assistant', helpResponse);
            return helpResponse;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '\n🛡️ **Protégé** (2h après défaite)' : '';
                const isChef = isLeader() ? ' 👑' : '';
                addToMemory(userId, 'user', `/clan ${args || 'info'}`);
                const response = `🏰 **${userClan.name}** (${userClan.id})${isChef}\n⭐ Niveau ${userClan.level} • 👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury}${protection}\n\n💡 **Commandes rapides:**\n• \`/clan info\` - Détails complets\n• \`/clan battle [ennemi]\` - Attaquer\n• \`/clan units\` - Gérer l'armée\n• \`/clan help\` - Guide complet`;
                addToMemory(userId, 'assistant', response);
                return response;
            } else {
                addToMemory(userId, 'user', `/clan ${args || 'help'}`);
                const response = `⚔️ **BIENVENUE DANS LE SYSTÈME DE CLANS !** 🏰\n\n🎯 **Tu n'as pas encore de clan**\n\n**🚀 POUR COMMENCER:**\n🏰 \`/clan create [nom]\` - Créer ton propre clan\n📜 \`/clan list\` - Voir tous les clans existants\n📨 \`/clan join\` - Voir tes invitations\n\n**❓ BESOIN D'AIDE ?**\n\`/clan help\` - Guide complet avec toutes les commandes\n\n**💡 CONSEIL:**\nCommence par créer ton clan ou demande à un ami de t'inviter dans le sien !\n\nExemple: \`/clan create Guerriers\``;
                addToMemory(userId, 'assistant', response);
                return response;
            }
    }
};
