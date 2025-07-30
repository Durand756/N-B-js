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
                const timeLeft = formatTime(3 * 24 * 60 * 60 * 1000 - (Date.now() - data.deletedClans[userId]));
                return `❌ Tu as supprimé un clan récemment !\n⏰ Attends encore ${timeLeft} pour en créer un nouveau.`;
            }
            
            if (findClan(clanName)) return "❌ Ce nom existe déjà ! Choisis autre chose.";
            
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
            return `🎉 Clan "${clanName}" créé !\n🆔 ID: **${clanId}**\n👑 Tu es le chef\n💰 100 pièces • ⭐ Niveau 1\n⚔️ 10 guerriers, 5 archers, 2 mages`;

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
            const totalPower = calculatePower(clan);
            const lastBattleTime = clan.lastDefeat || clan.lastVictory;
            const cooldownInfo = lastBattleTime ? 
                `\n⏳ Protection active: ${formatTime(60 * 60 * 1000 - (Date.now() - lastBattleTime))} restante` : '';
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}** (ID: ${clan.id})\n⭐ **Niveau ${clan.level}** (+${clan.level * 100} pts)\n👥 **${clan.members.length}/20 membres** (+${clan.members.length * 30} pts)\n💰 **${clan.treasury} pièces d'or**\n\n✨ **Progression:** ${clan.xp} XP (${nextXP} pour niveau ${clan.level + 1})\n📊 **Puissance totale:** ${totalPower} points${cooldownInfo}\n\n⚔️ **Armée:**\n• 🗡️ ${clan.units.w} guerriers (+${clan.units.w * 10} pts)\n• 🏹 ${clan.units.a} archers (+${clan.units.a * 8} pts)  \n• 🔮 ${clan.units.m} mages (+${clan.units.m * 15} pts)\n\n${protection}💡 Tape \`/clan help\` pour les stratégies !`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

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
            if (isProtected(enemyClan)) return `🛡️ ${enemyClan.name} est protégé ! Attends ${formatTime(60 * 60 * 1000 - (Date.now() - (enemyClan.lastDefeat || enemyClan.lastVictory)))}`;
            
            // Vérification du cooldown entre ces deux clans spécifiques
            if (!canAttack(attackerClan, enemyClan)) {
                const battleKey = `${attackerClan.id}-${enemyClan.id}`;
                const timeLeft = formatTime(60 * 60 * 1000 - (Date.now() - data.battles[battleKey]));
                return `⏳ Vous avez déjà combattu récemment ! Attends encore ${timeLeft} avant de réattaquer ce clan.`;
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
            let battleResult = `⚔️ **${attackerClan.name} VS ${enemyClan.name}**\n`;
            battleResult += `💪 Puissance: ${Math.round(attackerPower)} vs ${Math.round(defenderPower)}\n\n`;
            
            if (result === 'victory') {
                battleResult += `🏆 **VICTOIRE !**\n✨ +${xpGain} XP | 💰 +${goldChange}\n${attackerLevelUp ? '🆙 NIVEAU UP !\n' : ''}💀 Pertes: ~${Math.round(attackerLossRate * 100)}% unités`;
            } else if (result === 'defeat') {
                battleResult += `🛡️ **DÉFAITE...**\n✨ +${xpGain} XP | 💰 ${goldChange}\n💀 Pertes: ~${Math.round(attackerLossRate * 100)}% unités\n⏳ Protection active pendant 1h`;
            } else {
                battleResult += `🤝 **MATCH NUL !**\n✨ +${xpGain} XP pour les deux clans\n💰 Pas de transfert d'or\n💀 Pertes: ~20% unités`;
            }
            
            battleResult += `\n\n📊 **Analyse post-combat:**\n`;
            battleResult += `• ${attackerClan.name}: ${attackerClan.units.w}🗡️ ${attackerClan.units.a}🏹 ${attackerClan.units.m}🔮\n`;
            battleResult += `• ${enemyClan.name}: ${enemyClan.units.w}🗡️ ${enemyClan.units.a}🏹 ${enemyClan.units.m}🔮`;
            
            if (result !== 'draw') {
                battleResult += `\n\n💡 **Conseil stratégique:** ${result === 'victory' ? 
                    'Consolide ta défense avant la revanche !' : 
                    'Améliore tes unités ou recrute plus de membres !'}`;
            }
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} (${Math.round(attackerPower)}) VS ${enemyClan.name} (${Math.round(defenderPower)}) - ${result}`);
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans)
                .sort((a, b) => calculatePower(b) - calculatePower(a))
                .slice(0, 10);
            
            if (topClans.length === 0) return "❌ Aucun clan ! Crée le premier avec `/clan create [nom]`";
            
            let list = "🏆 **CLASSEMENT DES CLANS** (par puissance)\n\n";
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '';
                const totalPower = calculatePower(clan);
                const lastAction = clan.lastDefeat ? 'Défaite' : clan.lastVictory ? 'Victoire' : '';
                const timeInfo = isProtected(clan) ? ` (${formatTime(60 * 60 * 1000 - (Date.now() - (clan.lastDefeat || clan.lastVictory)))})` : '';
                
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}\n`;
                list += `   📊 ${totalPower} pts • ⭐ Niv.${clan.level} • 👥 ${clan.members.length}/20\n`;
                list += `   💰 ${clan.treasury} • ⚔️ ${clan.units.w}🗡️ ${clan.units.a}🏹 ${clan.units.m}🔮\n`;
                if (lastAction) list += `   ${lastAction}${timeInfo}\n`;
                list += `\n`;
            });
            
            return list + `📈 **Analyse:** ${Object.keys(data.clans).length} clans actifs\n💡 **Stratégie:** Attaque les clans sans 🛡️ et avec moins de mages !`;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ Tu n'as pas de clan !";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                const unitsPower = unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15;
                const efficiency = [
                    {type: 'mage', value: (15/80).toFixed(3), emoji: '🔮'},
                    {type: 'archer', value: (8/60).toFixed(3), emoji: '🏹'},
                    {type: 'guerrier', value: (10/40).toFixed(3), emoji: '🗡️'}
                ].sort((a,b) => b.value - a.value);
                
                let efficiencyInfo = `\n\n🌟 **EFFICACITÉ (puissance/💰):**\n`;
                efficiency.forEach(unit => {
                    efficiencyInfo += `${unit.emoji} ${unit.type}: ${unit.value} pts/💰\n`;
                });
                
                return `⚔️ **UNITÉS DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w} (+10 puissance chacun)\n🏹 **Archers:** ${unitsClan.units.a} (+8 puissance chacun)\n🔮 **Mages:** ${unitsClan.units.m} (+15 puissance chacun) ⭐\n\n💰 **Trésorerie:** ${unitsClan.treasury} pièces\n📊 **Puissance totale unités:** ${unitsPower} pts${efficiencyInfo}\n\n🛒 **ACHETER UNITÉS:**\n\`/clan units guerrier [nombre]\` - 40💰 (+10 pts)\n\`/clan units archer [nombre]\` - 60💰 (+8 pts)  \n\`/clan units mage [nombre]\` - 80💰 (+15 pts) 🌟\n\n💡 **Stratégie:** ${efficiency[0].emoji} Les ${efficiency[0].type}s sont les plus efficaces !`;
            }
            
            if (!isLeader()) return "❌ Seul le chef peut acheter des unités !";
            
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
            else return "❌ Type invalide ! Utilise: guerrier, archer, ou mage";
            
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ Fonds insuffisants ! Coût: ${cost}💰 (manque ${missing}💰)\n💡 Conseil: Combats pour gagner de l'or ou attends la prochaine récompense quotidienne.`;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            return `✅ ${quantity} ${unitName} acheté(s) pour ${cost}💰 !\n💰 Reste: ${unitsClan.treasury}💰\n📈 +${quantity * powerPerUnit} points de puissance\n💡 Tape \`/clan info\` pour voir ta nouvelle puissance`;

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
            return `⚔️ **GUIDE COMPLET DES CLANS**\n\n🏰 **DÉMARRAGE:**\n• \`/clan create [nom]\` - Créer ton clan (nom unique)\n• \`/clan info\` - Voir toutes tes stats détaillées\n• \`/clan list\` - Top 10 des clans les plus forts\n\n👥 **GESTION D'ÉQUIPE:**\n• \`/clan invite @user\` - Inviter un ami (chef seulement)\n• \`/clan join [id]\` - Rejoindre avec un ID court (ex: A3B7)\n• \`/clan leave\` - Quitter ou dissoudre ton clan\n• \`/clan promote @user\` - Transférer le leadership\n\n⚔️ **SYSTÈME DE COMBAT:**\n• \`/clan battle [id/nom]\` - Attaquer un rival\n• \`/clan units\` - Gérer ton armée\n\n📈 **CALCUL DE PUISSANCE:**\n• Niveau: +100 pts/niveau\n• Membres: +30 pts/personne  \n• Guerriers: +10 pts chacun (40💰)\n• Archers: +8 pts chacun (60💰)\n• Mages: +15 pts chacun (80💰) - Les plus forts !\n• XP: +5 pts par 100 XP\n\n🏆 **RÉSULTATS DE COMBAT:**\n• **Victoire** (diff >5%): +200 XP, +20% trésor ennemi (max 100💰)\n• **Match nul** (diff ≤5%): +100 XP, 0💰\n• **Défaite** (diff >5%): +50 XP, -10% trésor (max 50💰)\n\n🛡️ **PROTECTION:** 1h après combat (victoire ou défaite)\n💰 **ÉCONOMIE:** Gagne de l'or en gagnant, achète des unités\n📊 **PROGRESSION:** 1000 XP = +1 niveau\n\n💡 **STRATÉGIES GAGNANTES:**\n1️⃣ **Recrutement:** Plus de membres = +30 pts chacun\n2️⃣ **Mages:** Meilleur rapport puissance/prix (0.188 pts/💰)\n3️⃣ **Niveaux:** Monte en niveau pour +100 pts/niveau\n4️⃣ **Cibles:** Attaque les clans:\n   - Sans protection (pas de 🛡️)\n   - Avec moins de mages\n   - Avec trésor important\n5️⃣ **Défense:** Garde toujours 2-3 mages pour la défense\n6️⃣ **Timing:** Attaque quand tu viens de monter en niveau\n7️⃣ **Équilibre:** Maintiens un ratio 3:2:1 (guerriers:archers:mages)`;
