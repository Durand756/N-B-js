/**
 * Commande /clan - Système de gestion de clans optimisé
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande  
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, saveDataImmediate, sendMessage } = ctx;
    
    // Initialisation des données
   if (!ctx.clanData) {
    ctx.clanData = {
        clans: {}, 
        userClans: {}, 
        battles: {}, 
        invites: {}, 
        deletedClans: {}, 
        counter: 0,
        lastWeeklyReward: 0, 
        lastFinancialAid: 0, // Renommé de lastDailyCheck
        weeklyTop3: []
    };
    await saveDataImmediate();
    ctx.log.info("🏰 Structure des clans initialisée");
}
    let data = ctx.clanData;
    
    const userId = String(senderId);
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    
    // === UTILITAIRES ===
    const generateId = (type) => {
        data.counter = (data.counter || 0) + 1;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let id = '', num = data.counter + Date.now() % 10000;
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
        if (data.clans[nameOrId.toUpperCase()]) return data.clans[nameOrId.toUpperCase()];
        return Object.values(data.clans).find(c => c.name.toLowerCase() === nameOrId.toLowerCase());
    };
    
    const isLeader = () => getUserClan()?.leader === userId;
    
    const canCreateClan = () => {
        const deleteTime = data.deletedClans[userId];
        if (!deleteTime) return true;
        return (Date.now() - deleteTime) > (3 * 24 * 60 * 60 * 1000);
    };
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return days > 0 ? `${days}j ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };
    
    const calculatePower = (clan) => {
        const base = clan.level * 100 + clan.members.length * 50;
        const units = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
        const xpBonus = Math.floor(clan.xp / 50) * 10;
        return base + units + xpBonus;
    };
    
    const isProtected = (clan) => {
        const tenMin = 10 * 60 * 1000;
        return (clan.lastDefeat && (Date.now() - clan.lastDefeat) < tenMin) || 
               (clan.lastVictory && (Date.now() - clan.lastVictory) < tenMin);
    };
    
    const canAttack = (attackerClan, defenderClan) => {
        const lastBattleKey = `${attackerClan.id}-${defenderClan.id}`;
        const lastBattleTime = data.battles[lastBattleKey];
        return !lastBattleTime || (Date.now() - lastBattleTime) >= (10 * 60 * 1000);
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
    
    const checkFinancialAid = async () => {
    const now = Date.now();
    const fiveHours = 5 * 60 * 60 * 1000; // 5 heures en millisecondes
    
    if (!data.lastFinancialAid || (now - data.lastFinancialAid) >= fiveHours) {
        let aidedClans = 0;
        for (const clan of Object.values(data.clans)) {
            if (clan.treasury < 300) { // Changé de 0 à moins de 40
                clan.treasury += 100; // Donne 100 pièces au lieu d'un bonus aléatoire
                aidedClans++;
            }
        }
        data.lastFinancialAid = now; // Renommé de lastDailyCheck
        if (aidedClans > 0) {
            ctx.log.info(`💰 ${aidedClans} clans pauvres (<40💰) ont reçu leur aide de 100 pièces`);
            await save();
        }
    }
};
    
    const checkWeeklyRewards = async () => {
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        
        if (!data.lastWeeklyReward || (now - data.lastWeeklyReward) >= oneWeek) {
            const topClans = Object.values(data.clans)
                .sort((a, b) => calculatePower(b) - calculatePower(a))
                .slice(0, 3);
            
            if (topClans.length >= 3) {
                const rewards = [
                    {gold: 500, xp: 200, medal: '🥇'},
                    {gold: 300, xp: 150, medal: '🥈'},
                    {gold: 200, xp: 100, medal: '🥉'}
                ];
                
                data.weeklyTop3 = [];
                for (let i = 0; i < 3; i++) {
                    const clan = topClans[i];
                    clan.treasury += rewards[i].gold;
                    addXP(clan, rewards[i].xp);
                    data.weeklyTop3.push({name: clan.name, medal: rewards[i].medal});
                }
                
                data.lastWeeklyReward = now;
                ctx.log.info('🏆 Récompenses hebdomadaires distribuées au TOP 3');
                await save();
            }
        }
    };
    
    const notifyAttack = async (defenderId, attackerName, defenderName, result, xpGained, goldChange, losses) => {
        const resultText = result === 'victory' ? '🏆 VICTOIRE de l\'attaquant' : result === 'defeat' ? '💀 DÉFAITE de l\'attaquant' : '🤝 MATCH NUL';
        const goldText = goldChange > 0 ? `💰 +${goldChange} or volé` : goldChange < 0 ? `💰 ${goldChange} or perdu` : '💰 Pas de pillage';
        
        let notification = `⚔️ TON CLAN ATTAQUÉ !\n\n🔥 ${attackerName} VS ${defenderName}\n\n${resultText}\n✨ +${xpGained} XP gagné\n${goldText}\n\n💀 PERTES SUBIES:\n┣━━ 🗡️ -${losses.w} guerriers\n┣━━ 🏹 -${losses.a} archers\n┗━━ 🔮 -${losses.m} mages\n\n🛡️ Protection active 10min`;

        try {
            await sendMessage(defenderId, notification);
        } catch (err) {
            ctx.log.debug(`❌ Notification non envoyée à ${defenderId}`);
        }
    };
    
    const getImagePath = () => {
        try {
            const fs = require('fs');
            if (fs.existsSync('imgs/clan.png')) {
                return 'imgs/clan.png';
            }
        } catch (err) {
            ctx.log.debug('Image clan.png non trouvée');
        }
        return null;
    };
    
    // Vérifications automatiques
    await checkFinancialAid();
    await checkWeeklyRewards();
    
    switch (action) {
        case 'create':
            const clanName = args_parts.slice(1).join(' ');
            if (!clanName) return "⚔️ **CRÉER UN CLAN**\n\n📝 `/clan create [nom]`\n💡 Crée ton propre clan et deviens chef !\n\n🏰 Exemple: `/clan create Les Dragons`";
            if (getUserClan()) return "❌ Tu as déjà un clan ! Quitte-le d'abord avec `/clan leave`";
            if (!canCreateClan()) {
                const timeLeft = formatTime(3 * 24 * 60 * 60 * 1000 - (Date.now() - data.deletedClans[userId]));
                return `❌ Tu dois attendre encore ${timeLeft} avant de recréer un clan`;
            }
            if (findClan(clanName)) return "❌ Ce nom est déjà pris ! Choisis-en un autre";
            
            const clanId = generateId('clan');
            data.clans[clanId] = { 
                id: clanId, name: clanName, leader: userId, members: [userId], 
                level: 1, xp: 0, treasury: 100, 
                units: { w: 10, a: 5, m: 2 }, 
                lastDefeat: null, lastVictory: null 
            };
            data.userClans[userId] = clanId;
            await save();
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return `╔═══════════╗\n║ 🔥 CRÉÉ 🔥 \n╚═══════════╝\n\n🏰 ${clanName}\n🆔 ${clanId} | 👑 Chef | 💰 100\n\n⚔️ ARMÉE DE DÉPART:\n┣━━ 🗡️ 10 guerriers (+100 pts)\n┣━━ 🏹 5 archers (+40 pts)\n┗━━ 🔮 2 mages (+30 pts)\n\n╰─▸ Ton empire commence ! Recrute avec /clan invite`;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ **PAS DE CLAN**\n\n📝 Tu n'as pas de clan !\n🏰 Crée-en un: `/clan create [nom]`\n📜 Ou rejoins-en un: `/clan list` puis `/clan join [id]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️' : '';
            const totalPower = calculatePower(clan);
            const isOwner = clan.leader === userId;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            let infoResponse = `╔═══════════╗\n║ 🏰 INFO 🏰 \n╚═══════════╝\n\n🏰 ${clan.name} ${protection}\n🆔 ${clan.id} | ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20\n`;
            
            if (isOwner) {
                infoResponse += `⚡ Puissance: ${totalPower} pts\n💰 ${clan.treasury} pièces\n`;
            }
            
            infoResponse += `\n⚔️ ARMÉE:\n┣━━ 🗡️ ${clan.units.w} guerriers (+${clan.units.w * 10} pts)\n┣━━ 🏹 ${clan.units.a} archers (+${clan.units.a * 8} pts)\n┗━━ 🔮 ${clan.units.m} mages (+${clan.units.m * 15} pts)\n\n`;
            
            if (isOwner) {
                infoResponse += `✨ PROGRESSION:\n┣━━ ${clan.xp} XP total\n┗━━ ${nextXP} XP pour niv.${clan.level + 1}\n\n`;
            }
            
            infoResponse += `💡 **CONSEILS:**\n┣━━ Recrute des mages (+ puissants !)\n┣━━ Monte de niveau pour + de puissance\n┗━━ Invite des membres pour grossir\n\n╰─▸ /clan help pour toutes les commandes`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) return "❌ **CHEF UNIQUEMENT**\n\n👑 Seul le chef peut inviter !\n💡 Demande au chef de t'inviter ou quitte pour créer ton clan";
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) return "⚔️ **INVITER UN JOUEUR**\n\n📝 `/clan invite @utilisateur`\n💡 Invite quelqu'un dans ton clan\n\n👥 Exemple: `/clan invite @ami123`\n📋 Ou: `/clan invite 1234567890` (ID utilisateur)";
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) return "❌ Clan plein ! Maximum 20 membres";
            if (data.userClans[targetUser]) return "❌ Cette personne a déjà un clan !";
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) return "❌ Cette personne est déjà invitée !";
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            return `╔═══════════╗\n║ 📨 INVITÉ 📨 \n╚═══════════╝\n\n🏰 Invitation envoyée !\n👤 ${args_parts[1]} peut maintenant rejoindre ${inviterClan.name}\n🆔 Code clan: ${inviterClan.id}\n\n💡 **Il peut utiliser:**\n┣━━ \`/clan join ${inviterClan.id}\`\n┗━━ \`/clan join\` (voir ses invitations)\n\n╰─▸ Attends qu'il accepte !`;

        case 'joinClan':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) return "❌ **AUCUNE INVITATION**\n\n📭 Tu n'as pas d'invitations en attente\n📜 Regarde la liste: `/clan list`\n💬 Demande une invitation à un chef de clan";
                
                let inviteList = "╔═══════════╗\n║ 📬 INVITATIONS 📬 \n╚═══════════╝\n\n";
                myInvites.forEach((clanId) => {
                    const c = data.clans[clanId];
                    if (c) inviteList += `┣━━ 🏰 ${c.name}\n┃   🆔 ${clanId} | ⭐ Niv.${c.level}\n┃   👥 ${c.members.length}/20 membres\n┃   ⚡ ${calculatePower(c)} pts puissance\n┃\n`;
                });
                return inviteList + "\n💡 **REJOINDRE:**\n┗━━ `/clan join [id du clan]`";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan ! Quitte-le d'abord avec `/clan leave`";
            const joinClan = findClan(joinArg);
            if (!joinClan) return "❌ **CLAN INTROUVABLE**\n\n🔍 Ce clan n'existe pas ou plus\n📜 Vois la liste: `/clan list`\n🆔 Vérife l'ID ou le nom exact";
            if (!data.invites[userId]?.includes(joinClan.id)) return "❌ **PAS INVITÉ**\n\n📭 Tu n'es pas invité dans ce clan\n💬 Demande une invitation au chef\n📜 Ou regardes d'autres clans: `/clan list`";
            if (joinClan.members.length >= 20) return "❌ Ce clan est plein ! (20/20 membres)";
            
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            return `╔═══════════╗\n║ 🔥 REJOINT 🔥 \n╚═══════════╝\n\n🏰 Bienvenue dans ${joinClan.name} !\n👥 ${joinClan.members.length}/20 guerriers\n⭐ Niveau ${joinClan.level} | ⚡ ${calculatePower(joinClan)} pts\n\n💡 **TES NOUVELLES COMMANDES:**\n┣━━ \`/clan info\` - Voir les détails\n┣━━ \`/clan battle [id]\` - Attaquer\n┗━━ \`/clan leave\` - Quitter si besoin\n\n╰─▸ Prêt pour la guerre !`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ **PAS DE CLAN**\n\n🏠 Tu n'as pas de clan à quitter\n🏰 Crée-en un: `/clan create [nom]`";
            
            if (isLeader() && leaveClan.members.length > 1) return "❌ **CHEF AVEC MEMBRES**\n\n👑 Tu es chef et tu as des membres !\n🔄 Nomme un successeur: `/clan promote @membre`\n💡 Ou attends que tous partent d'eux-mêmes";
            
            if (isLeader()) {
                const clanName = leaveClan.name;
                leaveClan.members.forEach(memberId => delete data.userClans[memberId]);
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                await save();
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                return `╔═══════════╗\n║ 💥 DISSOUS 💥 \n╚═══════════╝\n\n🏰 ${clanName} n'existe plus\n⏰ Cooldown: 3 jours avant recréation\n\n💡 **MAINTENANT TU PEUX:**\n┣━━ \`/clan list\` - Voir d'autres clans\n┗━━ Attendre 3 jours pour recréer\n\n╰─▸ L'empire est tombé...`;
            } else {
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                return `╔═══════════╗\n║ 👋 PARTI 👋 \n╚═══════════╝\n\n🏰 Tu quittes ${leaveClan.name}\n\n💡 **MAINTENANT TU PEUX:**\n┣━━ \`/clan create [nom]\` - Créer ton clan\n┣━━ \`/clan list\` - Voir d'autres clans\n┗━━ Demander des invitations\n\n╰─▸ Bonne chance guerrier !`;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ **PAS DE CLAN**\n\n⚔️ Tu dois avoir un clan pour combattre !\n🏰 Crée-en un: `/clan create [nom]`";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) return "⚔️ **ATTAQUER UN CLAN**\n\n📝 `/clan battle [id ou nom]`\n💡 Attaque un clan pour gagner XP et or\n\n🎯 Exemple: `/clan battle ABC123`\n📜 Vois les cibles: `/clan list`\n\n💡 **ASTUCES:**\n┣━━ Plus tu es puissant, plus tu gagnes\n┣━━ Les mages donnent + de puissance\n┗━━ 10min de cooldown entre attaques";
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return "❌ **ENNEMI INTROUVABLE**\n\n🔍 Ce clan n'existe pas\n📜 Vois la liste: `/clan list`\n🆔 Vérife l'ID ou le nom exact";
            if (enemyClan.id === attackerClan.id) return "❌ Tu ne peux pas t'attaquer toi-même !";
            if (isProtected(enemyClan)) return `🛡️ **CLAN PROTÉGÉ**\n\n⏰ ${enemyClan.name} est protégé suite à un combat récent\n🕙 Protection: 10 minutes après chaque bataille\n⏳ Réessaie plus tard`;
            if (!canAttack(attackerClan, enemyClan)) return `⏳ **COOLDOWN ACTIF**\n\n🕙 Tu as déjà combattu ce clan récemment\n⏰ Attends 10 minutes entre chaque attaque\n🎯 Ou attaque un autre clan: \`/clan list\``;
            
            const calculateTotalPower = (clan) => {
                const unitPower = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
                const levelBonus = clan.level * 100;
                const memberBonus = clan.members.length * 50;
                const xpBonus = Math.floor(clan.xp / 50) * 10;
                return unitPower + levelBonus + memberBonus + xpBonus;
            };
            
            const attackerPower = calculateTotalPower(attackerClan);
            const defenderPower = calculateTotalPower(enemyClan);
            const powerDiff = attackerPower - defenderPower;
            
            let result, xpGain, goldChange, enemyXP, enemyGold;
            if (powerDiff === 0) {
                result = 'draw'; xpGain = 100; goldChange = 0; enemyXP = 100; enemyGold = 0;
            } else if (powerDiff > 0) {
                result = 'victory';
                xpGain = 200 + Math.floor(powerDiff / 10);
                goldChange = Math.min(150, Math.floor(enemyClan.treasury * 0.25));
                enemyXP = 50; enemyGold = -goldChange;
            } else {
                result = 'defeat';
                xpGain = 50;
                goldChange = -Math.min(100, Math.floor(attackerClan.treasury * 0.15));
                enemyXP = 150 + Math.floor(Math.abs(powerDiff) / 10);
                enemyGold = -goldChange;
            }
            
            const attackerLevelUp = addXP(attackerClan, xpGain);
            addXP(enemyClan, enemyXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGold);
            
            const calculateLosses = (clan, isAttacker, result, powerDiff) => {
                let lossRate = result === 'victory' ? (isAttacker ? 0.05 : 0.25) : 
                              result === 'defeat' ? (isAttacker ? 0.25 : 0.05) : 0.15;
                
                const diffModifier = Math.abs(powerDiff) / 1000;
                lossRate += diffModifier * (isAttacker ? 1 : -1) * 0.1;
                lossRate = Math.max(0.02, Math.min(0.4, lossRate));
                
                return {
                    w: Math.floor(clan.units.w * lossRate),
                    a: Math.floor(clan.units.a * lossRate),
                    m: Math.floor(clan.units.m * lossRate)
                };
            };
            
            const attackerLosses = calculateLosses(attackerClan, true, result, powerDiff);
            const defenderLosses = calculateLosses(enemyClan, false, result, powerDiff);
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - attackerLosses.w);
            attackerClan.units.a = Math.max(0, attackerClan.units.a - attackerLosses.a);
            attackerClan.units.m = Math.max(0, attackerClan.units.m - attackerLosses.m);
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - defenderLosses.w);
            enemyClan.units.a = Math.max(0, enemyClan.units.a - defenderLosses.a);
            enemyClan.units.m = Math.max(0, enemyClan.units.m - defenderLosses.m);
            
            if (result === 'victory') {
                enemyClan.lastDefeat = Date.now();
            } else if (result === 'defeat') {
                enemyClan.lastVictory = Date.now();
            }
            
            const battleKey = `${attackerClan.id}-${enemyClan.id}`;
            data.battles[battleKey] = Date.now();
            await save();
            
            if (enemyClan.members[0] !== userId) {
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, result, enemyXP, enemyGold, defenderLosses);
            }
            
            const isAttackerLeader = attackerClan.leader === userId;
            let battleResult = `╔═══════════╗\n║ ⚔️ BATAILLE ⚔️ \n╚═══════════╝\n\n🔥 ${attackerClan.name} VS ${enemyClan.name}\n\n`;
            
            if (isAttackerLeader) {
                battleResult += `📊 **PUISSANCES:**\n┣━━ 🏰 Toi: ${Math.round(attackerPower)} pts\n┗━━ 🏰 Ennemi: ${Math.round(defenderPower)} pts\n\n`;
            }
            
            if (result === 'victory') {
                battleResult += `🏆 **VICTOIRE ÉCRASANTE !**\n✨ +${xpGain} XP gagné\n💰 +${goldChange} or pillé${attackerLevelUp ? '\n🆙 NIVEAU UP !' : ''}\n\n💀 **TES PERTES:**\n┣━━ 🗡️ -${attackerLosses.w} guerriers\n┣━━ 🏹 -${attackerLosses.a} archers\n┗━━ 🔮 -${attackerLosses.m} mages`;
            } else if (result === 'defeat') {
                battleResult += `💀 **DÉFAITE AMÈRE !**\n✨ +${xpGain} XP d'expérience\n💰 ${goldChange} or perdu\n\n💀 **TES LOURDES PERTES:**\n┣━━ 🗡️ -${attackerLosses.w} guerriers\n┣━━ 🏹 -${attackerLosses.a} archers\n┗━━ 🔮 -${attackerLosses.m} mages`;
            } else {
                battleResult += `🤝 **MATCH NUL ÉPIQUE !**\n✨ +${xpGain} XP pour tous\n💰 Pas de pillage\n\n💀 **TES PERTES:**\n┣━━ 🗡️ -${attackerLosses.w} guerriers\n┣━━ 🏹 -${attackerLosses.a} archers\n┗━━ 🔮 -${attackerLosses.m} mages`;
            }
            
            battleResult += `\n\n💡 **CONSEILS:**\n┣━━ Recrute des unités: \`/clan units\`\n┣━━ Les mages sont + puissants\n┗━━ Monte de niveau pour + de force\n\n╰─▸ Prépare la revanche !`;
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${result}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans).sort((a, b) => calculatePower(b) - calculatePower(a)).slice(0, 10);
            if (topClans.length === 0) return "❌ **AUCUN CLAN**\n\n🏜️ Aucun clan n'existe encore !\n🏰 Sois le premier: `/clan create [nom]`\n👑 Deviens légendaire !";
            
            let list = `╔═══════════╗\n║ 🏆 TOP CLANS 🏆 \n╚═══════════╝\n\n`;
            
            if (data.weeklyTop3 && data.weeklyTop3.length > 0) {
                list += `🎉 **DERNIERS GAGNANTS HEBDO:**\n`;
                data.weeklyTop3.forEach(winner => {
                    list += `${winner.medal} ${winner.name}\n`;
                });
                list += `\n`;
            }
            
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '⚔️';
                const power = calculatePower(clan);
                
                list += `${medal} **${clan.name}** ${protection}\n┣━━ 🆔 ${clan.id}\n┣━━ ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20\n┣━━ 🗡️${clan.units.w} 🏹${clan.units.a} 🔮${clan.units.m}\n┗━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            });
            
            list += `**TOTAL:** ${Object.keys(data.clans).length} clans actifs\n\n💡 **COMMANDES:**\n┣━━ \`/clan battle [id]\` - Attaquer\n┣━━ \`/clan info\` - Voir ton clan\n┗━━ \`/clan create [nom]\` - Créer le tien\n\n🏆 **TOP 3 chaque semaine = PRIX !**`;
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ **PAS DE CLAN**\n\n⚔️ Tu dois avoir un clan pour gérer une armée !\n🏰 Crée-en un: `/clan create [nom]`";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                return `╔═══════════╗\n║ ⚔️ ARMÉE ⚔️ \n╚═══════════╝\n\n🏰 ${unitsClan.name}\n💰 ${unitsClan.treasury} pièces\n\n📊 **TON ARMÉE:**\n┣━━ 🗡️ ${unitsClan.units.w} guerriers (+${unitsClan.units.w * 10} pts)\n┣━━ 🏹 ${unitsClan.units.a} archers (+${unitsClan.units.a * 8} pts)\n┗━━ 🔮 ${unitsClan.units.m} mages (+${unitsClan.units.m * 15} pts)\n\n🛒 **PRIX D'ACHAT:**\n┣━━ 🗡️ Guerrier: 40💰 (+10 pts)\n┣━━ 🏹 Archer: 60💰 (+8 pts)\n┗━━ 🔮 Mage: 80💰 (+15 pts) ⭐ MEILLEUR\n\n💡 **ACHETER:**\n┣━━ \`/clan units guerrier [nombre]\`\n┣━━ \`/clan units archer [nombre]\`\n┗━━ \`/clan units mage [nombre]\`\n\n🎯 **CONSEIL:** Les mages donnent le plus de puissance !`;
            }
            
            if (!isLeader()) return "❌ **CHEF UNIQUEMENT**\n\n👑 Seul le chef peut acheter des unités !\n💬 Demande au chef de renforcer l'armée\n💡 Ou deviens chef toi-même !";
            
            let cost = 0, unitKey = '', unitName = '', powerPerUnit = 0;
            if (['guerrier', 'g', 'warrior', 'w'].includes(unitType)) { 
                cost = 40 * quantity; unitKey = 'w'; unitName = 'guerriers'; powerPerUnit = 10; 
            }
            else if (['archer', 'a'].includes(unitType)) { 
                cost = 60 * quantity; unitKey = 'a'; unitName = 'archers'; powerPerUnit = 8; 
            }
            else if (['mage', 'm'].includes(unitType)) { 
                cost = 80 * quantity; unitKey = 'm'; unitName = 'mages'; powerPerUnit = 15; 
            }
            else return "❌ **TYPE INVALIDE**\n\n📝 Types disponibles:\n┣━━ `guerrier` ou `g`\n┣━━ `archer` ou `a`\n┗━━ `mage` ou `m`\n\n💡 Exemple: `/clan units mage 5`";
            
            if (quantity < 1 || quantity > 100) return "❌ **QUANTITÉ INVALIDE**\n\n📊 Entre 1 et 100 unités maximum\n💡 Exemple: `/clan units mage 10`";
            
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ **PAS ASSEZ D'OR**\n\n💰 Coût: ${cost} pièces\n💰 Tu as: ${unitsClan.treasury} pièces\n💰 Manque: ${missing} pièces\n\n💡 **GAGNER DE L'OR:**\n┣━━ Attaque d'autres clans\n┣━━ Monte de niveau\n┗━━ Attends l'aide quotidienne si tu es pauvre`;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            return `╔═══════════╗\n║ 🛒 ACHAT 🛒 \n╚═══════════╝\n\n⚔️ **${quantity} ${unitName} recrutés !**\n💰 Reste: ${unitsClan.treasury} pièces\n⚡ +${quantity * powerPerUnit} pts de puissance\n📊 Total ${unitName}: ${unitsClan.units[unitKey]}\n\n💡 **MAINTENANT TU PEUX:**\n┣━━ \`/clan battle [id]\` - Attaquer avec ta nouvelle force\n┣━━ \`/clan info\` - Voir ta puissance totale\n┗━━ \`/clan units\` - Acheter encore plus d'unités\n\n╰─▸ Armée renforcée !`;

        case 'promote':
            if (!isLeader()) return "❌ **CHEF UNIQUEMENT**\n\n👑 Seul le chef peut nommer un successeur !\n💡 Cette commande sert à passer le leadership";
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) return "⚔️ **NOMMER UN NOUVEAU CHEF**\n\n📝 `/clan promote @utilisateur`\n💡 Transfère le leadership à un membre\n\n👑 Exemple: `/clan promote @membre123`\n📋 Ou: `/clan promote 1234567890` (ID utilisateur)\n\n⚠️ **ATTENTION:** Tu ne seras plus chef après !";
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) return "❌ **PAS DANS LE CLAN**\n\n👥 Cette personne n'est pas membre de ton clan\n📋 Vois les membres avec `/clan info`\n💡 Invite-la d'abord avec `/clan invite`";
            
            promoteClan.leader = newLeader;
            await save();
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id})`);
            return `╔═══════════╗\n║ 👑 NOUVEAU CHEF 👑 \n╚═══════════╝\n\n🏰 ${promoteClan.name}\n👑 ${args_parts[1]} est maintenant le chef !\n🔄 Tu n'es plus chef\n\n💡 **IL PEUT MAINTENANT:**\n┣━━ Inviter des membres\n┣━━ Acheter des unités\n┣━━ Gérer le clan\n┗━━ Te re-promouvoir si il veut\n\n╰─▸ Longue vie au nouveau roi !`;

        case 'userid':
            return `╔═══════════╗\n║ 🔍 TON ID 🔍 \n╚═══════════╝\n\n👤 **Ton ID utilisateur:**\n🆔 \`${userId}\`\n\n💡 **UTILITÉ:**\n┣━━ Pour recevoir des invitations\n┣━━ Les chefs peuvent t'inviter avec cet ID\n┣━━ Plus facile que de t'identifier\n┗━━ Copie-colle cet ID pour les invitations\n\n📋 **EXEMPLE D'USAGE:**\n┗━━ Chef fait: \`/clan invite ${userId}\`\n\n╰─▸ Partage cet ID pour rejoindre des clans !`;

        case 'help':
            const imagePath = getImagePath();
            if (imagePath) {
                try {
                    await sendMessage(userId, { image: imagePath });
                } catch (err) {
                    ctx.log.debug(`❌ Image ${imagePath} non envoyée à ${userId}`);
                }
            }
            
            return `╔═══════════╗\n║ ⚔️ GUIDE COMPLET ⚔️ \n╚═══════════╝\n\n🏰 **GESTION DE BASE:**\n┣━━ \`/clan create [nom]\` - Crée ton clan et deviens chef\n┣━━ \`/clan info\` - Vois les détails de ton clan\n┣━━ \`/clan list\` - Classement des clans les plus puissants\n┗━━ \`/clan userid\` - Ton ID pour les invitations\n\n👥 **GESTION D'ÉQUIPE:**\n┣━━ \`/clan invite @user\` - Invite un joueur (chef seulement)\n┣━━ \`/clan join [id]\` - Rejoins un clan via invitation\n┣━━ \`/clan leave\` - Quitte ton clan actuel\n┗━━ \`/clan promote @user\` - Nomme un nouveau chef\n\n⚔️ **GUERRE & ARMÉE:**\n┣━━ \`/clan battle [id]\` - Attaque un clan pour XP/OR\n┗━━ \`/clan units [type] [nb]\` - Achète des unités (chef seulement)\n\n📊 **SYSTÈME DE PUISSANCE:**\n┣━━ Niveau × 100 + Membres × 50 + XP÷50 × 10\n┣━━ 🗡️ Guerrier: 40💰 = +10 pts\n┣━━ 🏹 Archer: 60💰 = +8 pts\n┗━━ 🔮 Mage: 80💰 = +15 pts (MEILLEUR !)\n\n🎁 **BONUS AUTOMATIQUES:**\n┣━━ TOP 3 hebdomadaire = gros prix\n┣━━ Clans pauvres = aide quotidienne\n┣━━ Victoires = XP + OR volé\n┗━━ Protection 10min après bataille\n\n💡 **STRATÉGIES:**\n┣━━ Recrute des mages (+ efficaces)\n┣━━ Invite des membres (+ de puissance)\n┣━━ Attaque les clans + faibles d'abord\n┗━━ Monte de niveau pour dominer\n\n╰─▸ Forge ton empire et deviens légendaire ! 🔥`;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️' : '';
                const isOwner = userClan.leader === userId;
                const totalPower = calculatePower(userClan);
                let response = `╔═══════════╗\n║ ⚔️ TON CLAN ⚔️ \n╚═══════════╝\n\n🏰 ${userClan.name} ${protection}\n🆔 ${userClan.id} | ⭐ Niv.${userClan.level}\n👥 ${userClan.members.length}/20 membres`;
                
                if (isOwner) {
                    response += `\n⚡ ${totalPower} pts | 💰 ${userClan.treasury} pièces`;
                } else {
                    response += `\n⚡ ${totalPower} pts de puissance`;
                }
                
                response += `\n\n💡 **COMMANDES UTILES:**\n┣━━ \`/clan info\` - Détails complets\n┣━━ \`/clan battle [id]\` - Attaquer\n┣━━ \`/clan list\` - Voir les cibles`;
                
                if (isOwner) {
                    response += `\n┣━━ \`/clan units\` - Gérer l'armée\n┗━━ \`/clan invite @user\` - Recruter`;
                } else {
                    response += `\n┗━━ \`/clan help\` - Guide complet`;
                }
                
                response += `\n\n╰─▸ Prêt pour la domination !`;
                return response;
            } else {
                return `╔═══════════╗\n║ ⚔️ SYSTÈME CLAN ⚔️ \n╚═══════════╝\n\n🚫 **TU N'AS PAS DE CLAN**\n\n🏰 **CRÉER LE TIEN:**\n┗━━ \`/clan create [nom]\` - Deviens chef !\n\n📜 **REJOINDRE UN EXISTANT:**\n┣━━ \`/clan list\` - Voir tous les clans\n┗━━ Demande une invitation à un chef\n\n❓ **AIDE COMPLÈTE:**\n┗━━ \`/clan help\` - Guide détaillé\n\n💡 **POURQUOI REJOINDRE ?**\n┣━━ Batailles épiques contre d'autres clans\n┣━━ Système de niveaux et progression\n┣━━ Récompenses hebdomadaires TOP 3\n┗━━ Construis ton empire avec des alliés\n\n╰─▸ Ton destin t'attend, guerrier !`;
            }
    }
};
