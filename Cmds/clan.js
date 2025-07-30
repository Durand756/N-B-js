/**
 * Commande /clan - Système de gestion de clans optimisé et amélioré
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, saveDataImmediate, sendMessage } = ctx;
    
    // Initialisation des données
    const initClanData = () => ({
        clans: {}, // {id: {id, name, leader, members: [], level, xp, treasury, units: {w, a, m}, lastDefeat, lastBattles: {}}}
        userClans: {}, // {userId: clanId}
        battles: {}, // Historique des batailles complètes
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
    
    // === UTILITAIRES AVANCÉS ===
    
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
        const clan = clanId ? data.clans[clanId] : null;
        if (clan && !clan.lastBattles) clan.lastBattles = {};
        return clan;
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
    
    const getCooldownTime = () => {
        const deleteTime = data.deletedClans[userId];
        if (!deleteTime) return 0;
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        return Math.max(0, threeDays - (Date.now() - deleteTime));
    };
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        if (days > 0) return `${days}j ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };
    
    // Calcul de puissance avancé avec pondération du niveau
    const calculatePower = (clan) => {
        const levelPower = clan.level * 150; // Augmenté pour plus d'impact
        const membersPower = clan.members.length * 25;
        const unitsPower = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
        const xpBonus = Math.floor(clan.xp / 100) * 3;
        const levelMultiplier = 1 + (clan.level - 1) * 0.1; // Bonus multiplicateur
        
        return Math.round((levelPower + membersPower + unitsPower + xpBonus) * levelMultiplier);
    };
    
    // Vérification de protection générale (1h après défaite)
    const isProtected = (clan) => {
        if (!clan.lastDefeat) return false;
        return (Date.now() - clan.lastDefeat) < (60 * 60 * 1000); // 1h au lieu de 2h
    };
    
    // Vérification cooldown spécifique entre deux clans (1h)
    const canAttack = (attackerClan, targetClan) => {
        if (!attackerClan.lastBattles) attackerClan.lastBattles = {};
        const lastBattle = attackerClan.lastBattles[targetClan.id];
        if (!lastBattle) return { can: true };
        
        const cooldown = 60 * 60 * 1000; // 1h
        const timeLeft = cooldown - (Date.now() - lastBattle);
        
        if (timeLeft > 0) {
            return { 
                can: false, 
                timeLeft: formatTime(timeLeft)
            };
        }
        return { can: true };
    };
    
    const addXP = (clan, amount) => {
        clan.xp += amount;
        const newLevel = Math.floor(clan.xp / 1000) + 1;
        if (newLevel > clan.level) {
            const oldLevel = clan.level;
            clan.level = newLevel;
            // Bonus de niveau : unités gratuites
            const bonusUnits = newLevel - oldLevel;
            clan.units.w += bonusUnits * 2;
            clan.units.a += bonusUnits;
            clan.units.m += Math.floor(bonusUnits / 2);
            clan.treasury += bonusUnits * 50;
            return { leveledUp: true, levelsGained: bonusUnits, bonusGold: bonusUnits * 50 };
        }
        return { leveledUp: false };
    };
    
    // Système de combat amélioré avec logique stratégique
    const calculateBattleResult = (attacker, defender) => {
        const attackPower = calculatePower(attacker);
        const defensePower = calculatePower(defender);
        
        // Facteurs aléatoires stratégiques
        const attackerLuck = (Math.random() * 0.2) + 0.9; // 0.9 à 1.1
        const defenderBonus = 1.05; // Léger avantage défensif
        
        const finalAttackPower = Math.round(attackPower * attackerLuck);
        const finalDefensePower = Math.round(defensePower * defenderBonus);
        
        const powerDiff = finalAttackPower - finalDefensePower;
        const diffPercent = Math.abs(powerDiff) / Math.max(finalAttackPower, finalDefensePower);
        
        let result, confidence;
        
        if (powerDiff > 0 && diffPercent > 0.15) {
            result = 'victory';
            confidence = Math.min(95, 60 + diffPercent * 100);
        } else if (powerDiff < 0 && diffPercent > 0.15) {
            result = 'defeat';
            confidence = Math.min(95, 60 + diffPercent * 100);
        } else {
            result = 'draw';
            confidence = 50 + Math.random() * 20;
        }
        
        return {
            result,
            attackPower: finalAttackPower,
            defensePower: finalDefensePower,
            powerDiff,
            confidence: Math.round(confidence)
        };
    };
    
    // Calcul des pertes d'unités plus réaliste
    const calculateLosses = (clan, isWinner, battleIntensity) => {
        const totalUnits = clan.units.w + clan.units.a + clan.units.m;
        if (totalUnits === 0) return { w: 0, a: 0, m: 0 };
        
        const baseLossRate = isWinner ? 0.05 : 0.15; // 5% si victoire, 15% si défaite
        const intensityMultiplier = 0.5 + battleIntensity * 0.5;
        const finalLossRate = baseLossRate * intensityMultiplier;
        
        const wLoss = Math.floor(clan.units.w * finalLossRate * (0.8 + Math.random() * 0.4));
        const aLoss = Math.floor(clan.units.a * finalLossRate * (0.7 + Math.random() * 0.3));
        const mLoss = Math.floor(clan.units.m * finalLossRate * (0.6 + Math.random() * 0.2));
        
        return {
            w: Math.min(wLoss, clan.units.w),
            a: Math.min(aLoss, clan.units.a),
            m: Math.min(mLoss, clan.units.m)
        };
    };
    
    const save = async () => {
        ctx.clanData = data;
        await saveDataImmediate();
    };
    
    // Notification d'attaque améliorée
    const notifyAttack = async (defenderId, attackerName, defenderName, result, details) => {
        const resultEmoji = result === 'victory' ? '🏆' : result === 'defeat' ? '💀' : '🤝';
        const resultText = result === 'victory' ? 'DÉFAITE' : result === 'defeat' ? 'VICTOIRE' : 'MATCH NUL';
        
        const msg = `⚔️ **BATAILLE TERMINÉE !**\n${resultEmoji} ${attackerName} VS ${defenderName}\n📊 **Résultat:** ${resultText} pour ${defenderName}\n💪 Puissances: ${details.attackPower} vs ${details.defensePower}\n🛡️ Protégé pendant 1h`;
        
        try {
            await sendMessage(defenderId, msg.slice(0, 2000));
        } catch (err) {
            ctx.log.debug(`❌ Notification non envoyée à ${defenderId}: ${err.message}`);
        }
    };
    
    // === COMMANDES PRINCIPALES ===
    
    switch (action) {
        case 'create':
            const clanName = args_parts.slice(1).join(' ').trim();
            if (!clanName || clanName.length < 3) {
                return "⚔️ Usage: `/clan create [nom]` (min 3 caractères)\nExemple: `/clan create Dragons Noirs` 🐉";
            }
            
            if (clanName.length > 25) {
                return "❌ Nom trop long ! Maximum 25 caractères.";
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
                level: 1, xp: 0, treasury: 150,
                units: { w: 12, a: 6, m: 3 }, 
                lastDefeat: null, lastBattles: {}
            };
            data.userClans[userId] = clanId;
            await save();
            
            ctx.log.info(`🏰 Nouveau clan créé: ${clanName} (${clanId}) par ${userId}`);
            return `🎉 Clan "${clanName}" créé avec succès !\n🆔 **ID:** ${clanId}\n👑 **Chef:** Toi\n💰 **Trésor:** 150 pièces d'or\n⭐ **Niveau:** 1 (0/1000 XP)\n\n⚔️ **Armée de départ:**\n• 🗡️ 12 Guerriers (+120 puissance)\n• 🏹 6 Archers (+48 puissance)\n• 🔮 3 Mages (+45 puissance)\n\n📊 **Puissance totale:** ${calculatePower(data.clans[clanId])} points\n💡 Tape `/clan help` pour découvrir toutes les stratégies !`;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan ! Crée-en un avec `/clan create [nom]`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ Protégé ' : '';
            const totalPower = calculatePower(clan);
            const levelBonus = Math.round(clan.level * 150 * (1 + (clan.level - 1) * 0.1));
            
            // Statistiques de combat
            const totalBattles = Object.keys(clan.lastBattles || {}).length;
            const recentBattles = Object.values(clan.lastBattles || {})
                .filter(time => (Date.now() - time) < 24 * 60 * 60 * 1000).length;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}** (ID: ${clan.id})\n⭐ **Niveau ${clan.level}** (+${levelBonus} pts avec bonus)\n👥 **${clan.members.length}/20 membres** (+${clan.members.length * 25} pts)\n💰 **${clan.treasury} pièces d'or**\n\n✨ **Progression:** ${clan.xp}/${clan.level * 1000} XP (${nextXP} restants)\n📊 **Puissance totale:** ${totalPower} points\n⚔️ **Combats:** ${totalBattles} total, ${recentBattles} aujourd'hui\n\n🏗️ **Composition d'armée:**\n• 🗡️ ${clan.units.w} Guerriers (+${clan.units.w * 10} pts)\n• 🏹 ${clan.units.a} Archers (+${clan.units.a * 8} pts)  \n• 🔮 ${clan.units.m} Mages (+${clan.units.m * 15} pts) ⭐\n\n${protection}💡 **Stratégie:** Niveau élevé = multiplicateur de puissance !\n💰 Tape \`/clan units\` pour renforcer ton armée`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'invite':
            if (!isLeader()) return "❌ Seul le chef peut inviter des membres !";
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser || targetUser === userId) {
                return "⚔️ Usage: `/clan invite @utilisateur`\n❌ Tu ne peux pas t'inviter toi-même !";
            }
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) return "❌ Clan au maximum ! (20/20 membres)";
            if (data.userClans[targetUser]) return "❌ Cette personne a déjà un clan !";
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) {
                return "❌ Cette personne est déjà invitée dans ton clan !";
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            return `📨 Invitation envoyée à ${args_parts[1]} !\n🏰 Clan: **${inviterClan.name}** (${inviterClan.id})\n👥 Places: ${20 - inviterClan.members.length} disponibles\n\n💌 Il peut rejoindre avec: \`/clan join ${inviterClan.id}\``;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    return "❌ Aucune invitation reçue !\n💡 Demande à un chef de clan de t'inviter avec `/clan invite @toi`\n📜 Ou consulte `/clan list` pour voir les clans existants";
                }
                
                let inviteList = "📬 **TES INVITATIONS**\n\n";
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c) {
                        const power = calculatePower(c);
                        inviteList += `${i+1}. **${c.name}** (${clanId})\n   👥 ${c.members.length}/20 • ⭐ Niv.${c.level} • 📊 ${power} pts\n   💰 ${c.treasury} pièces • 👑 Chef actif\n\n`;
                    }
                });
                return inviteList + "Pour rejoindre: `/clan join [id]`\n💡 **Conseil:** Choisis un clan de haut niveau pour de meilleurs bonus !";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan ! Utilise `/clan leave` d'abord.";
            
            const joinClan = findClan(joinArg);
            if (!joinClan) return "❌ Clan introuvable ! Vérifie l'ID ou le nom.";
            if (!data.invites[userId]?.includes(joinClan.id)) {
                return "❌ Tu n'es pas invité dans ce clan !\n💡 Demande une invitation au chef avec `/clan invite`";
            }
            if (joinClan.members.length >= 20) return "❌ Clan complet ! (20/20 membres)";
            
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            
            // Bonus d'accueil
            joinClan.treasury += 25;
            const welcomeXP = 50;
            const levelResult = addXP(joinClan, welcomeXP);
            
            await save();
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            let joinMsg = `🎉 Bienvenue dans **${joinClan.name}** !\n👥 Membres: ${joinClan.members.length}/20\n💰 +25 pièces au trésor du clan\n✨ +${welcomeXP} XP de bienvenue`;
            
            if (levelResult.leveledUp) {
                joinMsg += `\n🆙 **NIVEAU UP !** Nouveau niveau ${joinClan.level} !`;
            }
            
            return joinMsg + `\n📊 Puissance du clan: ${calculatePower(joinClan)} points\n💡 Tape \`/clan info\` pour voir tous les détails !`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ Tu n'as pas de clan !";
            
            if (isLeader() && leaveClan.members.length > 1) {
                return "❌ Tu es le chef ! Promeus un nouveau chef d'abord avec:\n`/clan promote @nouveau_chef`\n\n👥 Membres disponibles: " + 
                       leaveClan.members.filter(id => id !== userId).length;
            }
            
            const clanName = leaveClan.name;
            
            if (isLeader()) {
                // Dissolution du clan
                leaveClan.members.forEach(memberId => delete data.userClans[memberId]);
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                
                ctx.log.info(`🏰 Clan dissous: ${clanName} par ${userId}`);
                await save();
                return `💥 Clan "${clanName}" dissous définitivement !\n⏰ Tu pourras créer un nouveau clan dans 3 jours.\n💔 ${leaveClan.members.length - 1} membres ont été libérés.`;
            } else {
                // Membre quitte
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                
                ctx.log.info(`👋 ${userId} a quitté le clan: ${clanName}`);
                await save();
                return `👋 Tu as quitté "${clanName}".\n🆓 Tu peux maintenant rejoindre un autre clan ou en créer un nouveau !\n📊 Ancienne puissance du clan: ${calculatePower(leaveClan)} points`;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ Tu n'as pas de clan ! Crée-en un d'abord.";
            if (!isLeader()) return "❌ Seul le chef peut déclarer la guerre !";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) {
                return "⚔️ **DÉCLARER LA GUERRE**\nUsage: `/clan battle [id ou nom]`\n\n💡 **STRATÉGIES DE COMBAT:**\n• Attaque les clans de niveau inférieur\n• Évite les clans protégés 🛡️\n• Privilégie les gros écarts de puissance\n• Cooldown de 1h entre combats identiques\n\nTape `/clan list` pour voir les cibles potentielles !";
            }
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return "❌ Clan ennemi introuvable ! Vérifie l'ID ou le nom.";
            if (enemyClan.id === attackerClan.id) return "❌ Tu ne peux pas attaquer ton propre clan !";
            
            if (isProtected(enemyClan)) {
                const protectionLeft = formatTime(60 * 60 * 1000 - (Date.now() - enemyClan.lastDefeat));
                return `🛡️ **${enemyClan.name}** est protégé !\n⏰ Protection restante: ${protectionLeft}\n💡 Trouve une autre cible dans \`/clan list\``;
            }
            
            // Vérification du cooldown spécifique
            const attackCheck = canAttack(attackerClan, enemyClan);
            if (!attackCheck.can) {
                return `⏰ **COOLDOWN ACTIF !**\nTu as déjà combattu **${enemyClan.name}** récemment.\n🕐 Attendre encore: ${attackCheck.timeLeft}\n\n💡 **Alternative:** Attaque d'autres clans dans `/clan list``;
            }
            
            // Vérification des unités minimales
            const attackerUnits = attackerClan.units.w + attackerClan.units.a + attackerClan.units.m;
            if (attackerUnits < 3) {
                return `❌ **ARMÉE INSUFFISANTE !**\nIl te faut au moins 3 unités pour combattre.\n💰 Achète des unités avec \`/clan units\`\n🏗️ Unités actuelles: ${attackerUnits}`;
            }
            
            // === LOGIQUE DE COMBAT AVANCÉE ===
            const battleResult = calculateBattleResult(attackerClan, enemyClan);
            const { result, attackPower, defensePower, powerDiff, confidence } = battleResult;
            
            // Calcul des gains/pertes basé sur le résultat et l'écart de puissance
            const powerRatio = Math.min(attackPower, defensePower) / Math.max(attackPower, defensePower);
            const battleIntensity = 1 - powerRatio; // Plus l'écart est grand, moins intense
            
            // Gains d'XP et d'or variables
            let attackerXP, attackerGold, defenderXP, defenderGold;
            
            if (result === 'victory') {
                attackerXP = Math.round(150 + battleIntensity * 100 + enemyClan.level * 20);
                attackerGold = Math.round(75 + battleIntensity * 50 + enemyClan.level * 10);
                defenderXP = Math.round(50 + battleIntensity * 30);
                defenderGold = Math.round(-attackerGold * 0.7);
            } else if (result === 'defeat') {
                attackerXP = Math.round(50 + battleIntensity * 40);
                attackerGold = Math.round(-50 - battleIntensity * 30);
                defenderXP = Math.round(120 + battleIntensity * 80 + attackerClan.level * 15);
                defenderGold = Math.round(60 + battleIntensity * 40);
            } else { // draw
                attackerXP = Math.round(80 + battleIntensity * 40);
                attackerGold = Math.round(-20 + Math.random() * 40);
                defenderXP = Math.round(80 + battleIntensity * 40);
                defenderGold = Math.round(-attackerGold);
            }
            
            // Application des gains
            const attackerLevelResult = addXP(attackerClan, attackerXP);
            const defenderLevelResult = addXP(enemyClan, defenderXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + attackerGold);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + defenderGold);
            
            // Calcul et application des pertes
            const attackerLosses = calculateLosses(attackerClan, result === 'victory', battleIntensity);
            const defenderLosses = calculateLosses(enemyClan, result === 'defeat', battleIntensity);
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - attackerLosses.w);
            attackerClan.units.a = Math.max(0, attackerClan.units.a - attackerLosses.a);
            attackerClan.units.m = Math.max(0, attackerClan.units.m - attackerLosses.m);
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - defenderLosses.w);
            enemyClan.units.a = Math.max(0, enemyClan.units.a - defenderLosses.a);
            enemyClan.units.m = Math.max(0, enemyClan.units.m - defenderLosses.m);
            
            // Gestion des protections et cooldowns
            if (result === 'defeat') {
                attackerClan.lastDefeat = Date.now();
            } else if (result === 'victory') {
                enemyClan.lastDefeat = Date.now();
            }
            
            // Enregistrement du combat pour le cooldown
            if (!attackerClan.lastBattles) attackerClan.lastBattles = {};
            if (!enemyClan.lastBattles) enemyClan.lastBattles = {};
            
            attackerClan.lastBattles[enemyClan.id] = Date.now();
            enemyClan.lastBattles[attackerClan.id] = Date.now();
            
            // Historique de bataille
            const battleId = generateId('battle');
            data.battles[battleId] = {
                id: battleId,
                timestamp: Date.now(),
                attacker: { id: attackerClan.id, name: attackerClan.name, power: attackPower },
                defender: { id: enemyClan.id, name: enemyClan.name, power: defensePower },
                result, confidence, battleIntensity: Math.round(battleIntensity * 100)
            };
            
            await save();
            
            // Notification au défenseur
            if (enemyClan.leader && enemyClan.leader !== userId) {
                await notifyAttack(enemyClan.leader, attackerClan.name, enemyClan.name, result, { attackPower, defensePower });
            }
            
            // Formatage du résultat
            let battleReport = `⚔️ **RAPPORT DE BATAILLE**\n\n🏰 **${attackerClan.name}** VS **${enemyClan.name}**\n💪 Puissance: ${attackPower} vs ${defensePower}\n📊 Écart: ${Math.abs(powerDiff)} pts (${Math.round(battleIntensity * 100)}% intensité)\n\n`;
            
            if (result === 'victory') {
                battleReport += `🏆 **VICTOIRE ÉCLATANTE !**\n✨ +${attackerXP} XP | 💰 +${attackerGold} pièces\n`;
                if (attackerLevelResult.leveledUp) {
                    battleReport += `🆙 **NIVEAU UP !** Niveau ${attackerClan.level} (+${attackerLevelResult.bonusGold} bonus)\n`;
                }
                const totalLosses = attackerLosses.w + attackerLosses.a + attackerLosses.m;
                battleReport += `💀 Pertes légères: ${totalLosses} unités\n🛡️ Tu peux re-attaquer d'autres clans !`;
            } else if (result === 'defeat') {
                battleReport += `💀 **DÉFAITE AMÈRE...**\n✨ +${attackerXP} XP | 💰 ${attackerGold} pièces\n`;
                if (attackerLevelResult.leveledUp) {
                    battleReport += `🆙 Niveau ${attackerClan.level} malgré la défaite !\n`;
                }
                const totalLosses = attackerLosses.w + attackerLosses.a + attackerLosses.m;
                battleReport += `💀 Lourdes pertes: ${totalLosses} unités\n🛡️ Protection activée (1h)\n💡 Renforce ton armée avec \`/clan units\``;
            } else {
                battleReport += `🤝 **MATCH NUL HÉROÏQUE !**\n✨ +${attackerXP} XP | 💰 ${attackerGold} pièces\n`;
                if (attackerLevelResult.leveledUp) {
                    battleReport += `🆙 Niveau ${attackerClan.level} gagné !\n`;
                }
                const totalLosses = attackerLosses.w + attackerLosses.a + attackerLosses.m;
                battleReport += `💀 Pertes modérées: ${totalLosses} unités\n⚖️ Combat équilibré, aucune protection\n💡 Améliore ta stratégie pour la prochaine fois !`;
            }
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} VS ${enemyClan.name} - ${result} (${attackPower} vs ${defensePower})`);
            return battleReport;

        case 'list':
            const topClans = Object.values(data.clans)
                .map(clan => ({
                    ...clan,
                    power: calculatePower(clan),
                    isProtected: isProtected(clan)
                }))
                .sort((a, b) => b.power - a.power || b.level - a.level)
                .slice(0, 12);
            
            if (topClans.length === 0) {
                return "❌ Aucun clan existant !\n🏰 Sois le premier à créer un clan avec `/clan create [nom]`\n💡 Deviens une légende !";
            }
            
            let list = "🏆 **CLASSEMENT DES CLANS** (Top 12)\n\n";
            const userClan = getUserClan();
            
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = clan.isProtected ? '🛡️' : '';
                const isMyclan = userClan && clan.id === userClan.id ? '👑' : '';
                const threat = clan.power > (userClan ? calculatePower(userClan) : 0) ? '⚠️' : '';
                
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}${isMyclan}${threat}\n`;
                list += `   📊 ${clan.power} pts • ⭐ Niv.${clan.level} • 👥 ${clan.members.length}/20\n`;
                list += `   💰 ${clan.treasury} • ⚔️ ${clan.units.w}g/${clan.units.a}a/${clan.units.m}m\n`;
                if (clan.isProtected) {
                    const protectionLeft = formatTime(60 * 60 * 1000 - (Date.now() - clan.lastDefeat));
                    list += `   ⏰ Protection: ${protectionLeft}\n`;
                }
                list += '\n';
            });
            
            const totalClans = Object.keys(data.clans).length;
            const avgLevel = Object.values(data.clans).reduce((sum, c) => sum + c.level, 0) / totalClans;
            
            list += `📈 **Statistiques:** ${totalClans} clans actifs\n`;
            list += `📊 **Niveau moyen:** ${avgLevel.toFixed(1)}\n`;
            list += `💡 **Légende:** 🛡️=Protégé 👑=Ton clan ⚠️=Plus fort que toi\n`;
            list += `🎯 **Conseil:** Attaque les clans sans 🛡️ et de niveau inférieur !`;
            
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ Tu n'as pas de clan ! Crée-en un d'abord.";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = Math.max(1, parseInt(args_parts[2]) || 1);
            
            if (!unitType) {
                const totalUnitsPower = unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15;
                const efficiency = unitsClan.treasury > 0 ? Math.round(totalUnitsPower / (unitsClan.treasury + 1) * 100) : 0;
                
                return `⚔️ **ARMÉE DE ${unitsClan.name}**\n\n🗡️ **Guerriers:** ${unitsClan.units.w} (+${unitsClan.units.w * 10} pts)\n   💰 Coût: 40 pièces | 📊 Ratio: 0.25 pts/pièce\n\n🏹 **Archers:** ${unitsClan.units.a} (+${unitsClan.units.a * 8} pts)\n   💰 Coût: 60 pièces | 📊 Ratio: 0.13 pts/pièce\n\n🔮 **Mages:** ${unitsClan.units.m} (+${unitsClan.units.m * 15} pts) ⭐\n   💰 Coût: 80 pièces | 📊 Ratio: 0.19 pts/pièce\n\n💰 **Trésorerie:** ${unitsClan.treasury} pièces\n📊 **Puissance unités:** ${totalUnitsPower} pts\n⚡ **Efficacité:** ${efficiency}%\n\n🛒 **ACHETER UNITÉS:**\n\`/clan units guerrier [nombre]\` - Moins cher, résistant\n\`/clan units archer [nombre]\` - Équilibré, polyvalent\n\`/clan units mage [nombre]\` - Plus cher, très puissant ⭐\n\n💡 **STRATÉGIE OPTIMALE:**\n• **Début:** Focus sur guerriers (économique)\n• **Milieu:** Équilibre avec archers\n• **Avancé:** Mages pour dominer\n• **Budget serré:** 2 guerriers = presque 1 mage\n• **Richesse:** Mages pour ratio puissance/espace`;
            }
            
            if (!isLeader()) return "❌ Seul le chef peut gérer l'armée !";
            
            let cost = 0, unitKey = '', unitName = '';
            if (['guerrier', 'g', 'warrior', 'w'].includes(unitType)) { 
                cost = 40 * quantity; unitKey = 'w'; unitName = 'Guerrier'; 
            }
            else if (['archer', 'a'].includes(unitType)) { 
                cost = 60 * quantity; unitKey = 'a'; unitName = 'Archer'; 
            }
            else if (['mage', 'm', 'magicien'].includes(unitType)) { 
                cost = 80 * quantity; unitKey = 'm'; unitName = 'Mage'; 
            }
            else {
                return "❌ Type d'unité invalide !\n✅ **Unités disponibles:**\n• `guerrier` ou `g` - 40💰 (+10 pts)\n• `archer` ou `a` - 60💰 (+8 pts)\n• `mage` ou `m` - 80💰 (+15 pts)";
            }
            
            if (quantity > 50) return "❌ Maximum 50 unités par achat !";
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ **FONDS INSUFFISANTS !**\n💰 Coût: ${cost} pièces\n💰 Disponible: ${unitsClan.treasury} pièces\n💰 Manquant: ${missing} pièces\n\n💡 **Comment gagner de l'or:**\n• Gagner des combats (+75-150💰)\n• Monter de niveau (+50💰/niveau)\n• Recruter des membres (+25💰/nouveau)`;
            }
            
            const oldPower = calculatePower(unitsClan);
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            const newPower = calculatePower(unitsClan);
            const powerGain = newPower - oldPower;
            
            await save();
            
            const plural = quantity > 1 ? 's' : '';
            let purchaseMsg = `✅ **ACHAT RÉUSSI !**\n🛒 ${quantity} ${unitName}${plural} acheté${plural} pour ${cost}💰\n\n📊 **Impact:**\n• Puissance: ${oldPower} → ${newPower} (+${powerGain} pts)\n• Trésor restant: ${unitsClan.treasury}💰\n\n⚔️ **Nouvelle composition:**\n• 🗡️ ${unitsClan.units.w} Guerriers\n• 🏹 ${unitsClan.units.a} Archers\n• 🔮 ${unitsClan.units.m} Mages\n\n🎯 **Prêt pour la bataille !** Tape \`/clan list\` pour trouver des cibles`;
            
            return purchaseMsg;

        case 'promote':
            if (!isLeader()) return "❌ Seul le chef actuel peut promouvoir un successeur !";
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader || newLeader === userId) {
                return "⚔️ Usage: `/clan promote @nouveau_chef`\n❌ Tu ne peux pas te promouvoir toi-même !";
            }
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) {
                return `❌ Cette personne n'est pas membre de **${promoteClan.name}** !\n👥 Membres actuels: ${promoteClan.members.length}/20\n💡 Invite-la d'abord avec \`/clan invite @personne\``;
            }
            
            const oldLeader = userId;
            promoteClan.leader = newLeader;
            await save();
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id}), ancien: ${oldLeader}`);
            return `👑 **PASSATION DE POUVOIR !**\n\n🎉 ${args_parts[1]} est maintenant le chef de **${promoteClan.name}** !\n🔄 Ancien chef: <@${oldLeader}>\n📊 Puissance du clan: ${calculatePower(promoteClan)} points\n\n💡 **Nouveau chef:** Tu peux maintenant:\n• Déclarer des guerres avec \`/clan battle\`\n• Acheter des unités avec \`/clan units\`\n• Inviter des membres avec \`/clan invite\``;

        case 'stats':
            const statsClan = getUserClan();
            if (!statsClan) return "❌ Tu n'as pas de clan pour voir les statistiques !";
            
            const battles = Object.values(data.battles).filter(b => 
                b.attacker.id === statsClan.id || b.defender.id === statsClan.id
            );
            
            let wins = 0, losses = 0, draws = 0;
            let totalDamageDealt = 0, totalDamageTaken = 0;
            
            battles.forEach(battle => {
                const wasAttacker = battle.attacker.id === statsClan.id;
                if ((wasAttacker && battle.result === 'victory') || (!wasAttacker && battle.result === 'defeat')) {
                    wins++;
                } else if ((wasAttacker && battle.result === 'defeat') || (!wasAttacker && battle.result === 'victory')) {
                    losses++;
                } else {
                    draws++;
                }
            });
            
            const winRate = battles.length > 0 ? Math.round((wins / battles.length) * 100) : 0;
            const recentBattles = battles.filter(b => (Date.now() - b.timestamp) < 7 * 24 * 60 * 60 * 1000).length;
            
            return `📊 **STATISTIQUES DE ${statsClan.name}**\n\n🏆 **Historique de combat:**\n• ⚔️ ${battles.length} batailles totales\n• 🥇 ${wins} victoires\n• 💀 ${losses} défaites  \n• 🤝 ${draws} matches nuls\n• 📈 Taux de victoire: ${winRate}%\n• 📅 Combats cette semaine: ${recentBattles}\n\n📊 **Performance actuelle:**\n• 💪 Puissance: ${calculatePower(statsClan)} points\n• ⭐ Niveau: ${statsClan.level}\n• 👥 Membres: ${statsClan.members.length}/20\n• 💰 Richesse: ${statsClan.treasury} pièces\n\n🏅 **Classement:** ${Object.values(data.clans).filter(c => calculatePower(c) > calculatePower(statsClan)).length + 1}/${Object.keys(data.clans).length}\n\n💡 **Conseils d'amélioration:**\n${winRate < 30 ? '• Focus sur le recrutement et l\'achat d\'unités\n• Évite les clans plus forts' : winRate > 70 ? '• Excellent ! Continue à dominer\n• Aide les clans plus faibles à progresser' : '• Équilibre ton armée\n• Choisis tes combats stratégiquement'}`;

        case 'help':
            return `⚔️ **GUIDE COMPLET DES CLANS v2.0**\n\n🏰 **CRÉATION & GESTION:**\n• \`/clan create [nom]\` - Créer ton empire (min 3 car.)\n• \`/clan info\` - Dashboard complet avec toutes tes stats\n• \`/clan list\` - Top 12 + analyse stratégique\n• \`/clan stats\` - Historique de tes combats\n\n👥 **SYSTÈME D'ALLIANCE:**\n• \`/clan invite @user\` - Recruter des guerriers (chef)\n• \`/clan join [id]\` - Rejoindre avec ID court (ex: A3B7)  \n• \`/clan leave\` - Quitter ou dissoudre définitivement\n• \`/clan promote @user\` - Transmettre le leadership\n\n⚔️ **GUERRE STRATÉGIQUE:**\n• \`/clan battle [id/nom]\` - Conquête et pillage\n• **NOUVEAU:** Cooldown 1h entre mêmes adversaires\n• **NOUVEAU:** Protection 1h après défaite seulement\n• **NOUVEAU:** Calculs de puissance améliorés\n\n🏗️ **ÉCONOMIE & ARMÉE:**\n• \`/clan units\` - Voir composition + ratios optimaux\n• \`/clan units guerrier [X]\` - 40💰 (+10 pts) - Économique\n• \`/clan units archer [X]\` - 60💰 (+8 pts) - Équilibré\n• \`/clan units mage [X]\` - 80💰 (+15 pts) - Elite ⭐\n\n📈 **SYSTÈME DE PUISSANCE v2.0:**\n• **Niveau:** +150 pts/niveau + multiplicateur x1.1^(niveau-1)\n• **Membres:** +25 pts/personne (max 20)\n• **Unités:** Guerriers +10, Archers +8, Mages +15\n• **XP Bonus:** +3 pts par 100 XP accumulés\n• **Formule:** (Base + Unités + XP) × Multiplicateur niveau\n\n🏆 **GAINS DE COMBAT VARIABLES:**\n• **Victoire:** 150-270 XP + 75-150💰 (selon niveau ennemi)\n• **Match Nul:** 80-120 XP + 0-40💰 (aléatoire)\n• **Défaite:** 50-90 XP - 50-80💰 + protection 1h\n\n🎯 **STRATÉGIES AVANCÉES:**\n• **Début:** Guerriers (économique) + recrutement\n• **Développement:** Équilibre archers + niveau up\n• **Domination:** Focus mages (puissance max)\n• **Anti-protection:** Attaque plusieurs cibles\n• **Timing:** Évite les cooldowns de 1h\n\n💎 **BONUS DE NIVEAU:**\n• **Level up:** +2 guerriers, +1 archer, +0.5 mage\n• **Level up:** +50💰 bonus immédiat\n• **Multiplicateur:** Chaque niveau = +10% puissance totale\n\n🛡️ **MÉCANIQUES DE PROTECTION:**\n• **1h de protection** après DÉFAITE uniquement\n• **Cooldown 1h** entre mêmes adversaires\n• **Liberté totale** pour attaquer d'autres clans\n• **Protection visible** dans \`/clan list\` avec timer\n\n💡 **CONSEILS DE PRO:**\n• Niveau élevé = multiplicateur de puissance permanent\n• Mages = meilleur ratio puissance/prix long terme\n• Recrutement = +25 pts + bonus économique (+25💰)\n• Timing des attaques = éviter les protections\n• Diversification = plusieurs cibles pour éviter cooldowns`;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ Protégé ' : '';
                const power = calculatePower(userClan);
                const rank = Object.values(data.clans).filter(c => calculatePower(c) > power).length + 1;
                const totalClans = Object.keys(data.clans).length;
                
                return `🏰 **${userClan.name}** (${userClan.id})\n⭐ Niveau ${userClan.level} • 👥 ${userClan.members.length}/20 • 💰 ${userClan.treasury} ${protection}\n📊 Puissance: ${power} points (#${rank}/${totalClans})\n⚔️ ${userClan.units.w}g/${userClan.units.a}a/${userClan.units.m}m\n\nTape \`/clan help\` pour le guide complet v2.0 !`;
            } else {
                return `⚔️ **BIENVENUE DANS L'ÈRE DES CLANS v2.0 !**\n\nTu n'as pas encore forgé ton empire. Voici comment devenir une légende :\n\n🏰 \`/clan create [nom]\` - Fonder ton royaume\n📜 \`/clan list\` - Analyser la concurrence (Top 12)\n❓ \`/clan help\` - Guide stratégique complet\n📊 \`/clan stats\` - Voir tes performances\n\n💎 **NOUVEAUTÉS v2.0:**\n• Cooldowns intelligents (1h entre mêmes adversaires)\n• Calcul de puissance avec multiplicateurs de niveau\n• Gains variables selon la stratégie\n• Système de protection optimisé\n• Interface améliorée avec plus de détails\n\n🚀 **Astuce de démarrage:** Crée ton clan, recrute des alliés actifs, puis focus sur le niveau pour débloquer les multiplicateurs de puissance !`;
    }
};
