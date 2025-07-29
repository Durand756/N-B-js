/**
 * Commande /clan - Système de gestion de clans avec batailles amélioré
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, saveDataToGitHub, loadDataFromGitHub } = ctx;
    
    // Structure des données de clan améliorée
    const initializeClanData = () => ({
        clans: {}, // {clanId: {id, name, leader, members: [], level, xp, treasury, creation_date, description, slogan, emblem, units: {warriors, archers, mages}, lastDefeat}}
        userClans: {}, // {userId: clanId}
        battles: {}, // {battleId: {id, attacker, defender, status, result, timestamp, details}}
        invitations: {}, // {userId: [clanIds]}
        battleHistory: {}, // {clanId: [battles]} - nettoyé périodiquement
        clanNames: {}, // {normalizedName: clanId} - pour éviter duplicatas
        uniqueCounter: 0 // Pour générer des IDs uniques
    });
    
    // Gestion du stockage persistant des clans
    let clanData;
    
    // Charger les données depuis GitHub au démarrage
    try {
        const loadedData = await loadDataFromGitHub();
        if (loadedData && loadedData.clanData) {
            ctx.clanData = loadedData.clanData;
        }
    } catch (err) {
        console.log(`🔄 Chargement initial différé: ${err.message}`);
    }
    
    // Initialiser les données de clan si nécessaire
    if (!ctx.clanData) {
        ctx.clanData = initializeClanData();
    }
    clanData = ctx.clanData;
    
    // Fonction de sauvegarde des données de clan
    const saveClanData = (data) => {
        ctx.clanData = data;
        // Sauvegarder immédiatement sur GitHub via le contexte
        saveDataToGitHub().catch(err => 
            console.log(`🔄 Sauvegarde clan différée: ${err.message}`)
        );
    };
    
    // Nettoyage automatique des anciennes batailles (> 7 jours)
    const cleanupOldData = () => {
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        // Nettoyer les batailles
        Object.keys(clanData.battles).forEach(battleId => {
            if (clanData.battles[battleId].timestamp < weekAgo) {
                delete clanData.battles[battleId];
            }
        });
        
        // Nettoyer l'historique
        Object.keys(clanData.battleHistory).forEach(clanId => {
            clanData.battleHistory[clanId] = clanData.battleHistory[clanId]?.filter(
                battle => battle.timestamp > weekAgo
            ) || [];
        });
        
        saveClanData(clanData);
    };
    
    // Nettoyage périodique
    cleanupOldData();
    
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    const userId = String(senderId);
    
    // Fonctions utilitaires améliorées
    const getUserClan = (userId) => {
        const clanId = clanData.userClans[userId];
        return clanId ? clanData.clans[clanId] : null;
    };
    
    const isLeader = (userId, clanId) => {
        return clanData.clans[clanId]?.leader === userId;
    };
    
    const generateUniqueId = (prefix) => {
        clanData.uniqueCounter = (clanData.uniqueCounter || 0) + 1;
        return `${prefix}_${Date.now()}_${clanData.uniqueCounter}`;
    };
    
    const normalizeName = (name) => {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '');
    };
    
    const findClanByName = (name) => {
        const normalized = normalizeName(name);
        const clanId = clanData.clanNames[normalized];
        return clanId ? clanData.clans[clanId] : null;
    };
    
    const findClanById = (id) => {
        return clanData.clans[id] || null;
    };
    
    const addXP = (clanId, amount) => {
        if (clanData.clans[clanId]) {
            clanData.clans[clanId].xp += amount;
            const newLevel = Math.floor(clanData.clans[clanId].xp / 1000) + 1;
            if (newLevel > clanData.clans[clanId].level) {
                clanData.clans[clanId].level = newLevel;
                return true; // Level up!
            }
        }
        return false;
    };
    
    const calculateClanPower = (clan) => {
        const basePower = clan.level * 100 + clan.members.length * 50;
        const unitsPower = (clan.units.warriors * 15) + (clan.units.archers * 12) + (clan.units.mages * 20);
        const randomFactor = Math.random() * 150;
        return basePower + unitsPower + randomFactor;
    };
    
    const isProtectedFromAttack = (clan) => {
        if (!clan.lastDefeat) return false;
        const protectionTime = 2 * 60 * 60 * 1000; // 2 heures
        return (Date.now() - clan.lastDefeat) < protectionTime;
    };
    
    const getProtectionTimeLeft = (clan) => {
        if (!clan.lastDefeat) return 0;
        const protectionTime = 2 * 60 * 60 * 1000; // 2 heures
        const timeLeft = protectionTime - (Date.now() - clan.lastDefeat);
        return Math.max(0, timeLeft);
    };
    
    const formatTime = (ms) => {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `${hours}h ${minutes}min`;
    };

    // Commandes principales
    switch (action) {
        case 'create':
        case 'créer':
            const newClanName = args_parts.slice(1).join(' ');
            if (!newClanName) {
                return "⚔️ Usage: /clan create [nom du clan]\n\nExemple: /clan create Les Dragons de Feu 🐉";
            }
            
            if (getUserClan(userId)) {
                return "❌ Tu fais déjà partie d'un clan ! Utilise `/clan leave` pour le quitter d'abord.";
            }
            
            // Vérifier si le nom existe déjà (normalisé)
            const normalizedName = normalizeName(newClanName);
            if (clanData.clanNames[normalizedName]) {
                return "❌ Un clan avec ce nom existe déjà ! Choisis un autre nom.";
            }
            
            const clanId = generateUniqueId('clan');
            clanData.clans[clanId] = {
                id: clanId,
                name: newClanName,
                leader: userId,
                members: [userId],
                level: 1,
                xp: 0,
                treasury: 100,
                creation_date: Date.now(),
                description: "Un nouveau clan prometteur !",
                slogan: "Ensemble vers la victoire !",
                emblem: "⚔️",
                units: {
                    warriors: 10,
                    archers: 5,
                    mages: 2
                },
                lastDefeat: null
            };
            clanData.userClans[userId] = clanId;
            clanData.battleHistory[clanId] = [];
            clanData.clanNames[normalizedName] = clanId;
            
            saveClanData(clanData);
            return `🎉 Clan "${newClanName}" créé avec succès !\n` +
                   `🆔 ID: \`${clanId}\`\n` +
                   `👑 Tu es maintenant le chef de clan.\n` +
                   `💰 Trésorerie: 100 pièces\n` +
                   `⭐ Niveau: 1\n` +
                   `⚔️ Unités: 10 guerriers, 5 archers, 2 mages\n\n` +
                   `Utilise /clan help pour voir toutes tes options !`;

        case 'info':
            const userClan = getUserClan(userId);
            if (!userClan) {
                return "❌ Tu ne fais partie d'aucun clan ! Crée-en un avec `/clan create [nom]`";
            }
            
            const memberCount = userClan.members.length;
            const nextLevelXP = (userClan.level * 1000) - userClan.xp;
            const pendingInvites = Object.keys(clanData.invitations).filter(
                uid => clanData.invitations[uid].includes(userClan.id)
            ).length;
            
            let info = `🏰 **${userClan.name}** ${userClan.emblem}\n`;
            info += `🆔 ID: \`${userClan.id}\`\n`;
            info += `💬 "${userClan.slogan}"\n`;
            info += `👑 Chef: ${userClan.leader === userId ? 'Toi' : `<@${userClan.leader}>`}\n`;
            info += `👥 Membres: ${memberCount}/20\n`;
            info += `⭐ Niveau: ${userClan.level}\n`;
            info += `✨ XP: ${userClan.xp} (${nextLevelXP} pour le niveau suivant)\n`;
            info += `💰 Trésorerie: ${userClan.treasury} pièces\n`;
            info += `📨 Invitations en attente: ${pendingInvites}\n`;
            info += `⚔️ Unités: ${userClan.units.warriors} guerriers, ${userClan.units.archers} archers, ${userClan.units.mages} mages\n`;
            
            if (isProtectedFromAttack(userClan)) {
                const timeLeft = getProtectionTimeLeft(userClan);
                info += `🛡️ Protection active: ${formatTime(timeLeft)}\n`;
            }
            
            info += `📝 ${userClan.description}`;
            
            return info;

        case 'invite':
        case 'inviter':
            const targetUser = args_parts[1];
            if (!targetUser) {
                return "⚔️ Usage: /clan invite @utilisateur";
            }
            
            const inviterClan = getUserClan(userId);
            if (!inviterClan) {
                return "❌ Tu dois faire partie d'un clan pour inviter quelqu'un !";
            }
            
            if (!isLeader(userId, clanData.userClans[userId])) {
                return "❌ Seul le chef de clan peut inviter de nouveaux membres !";
            }
            
            const targetId = targetUser.replace(/[<@!>]/g, '');
            if (getUserClan(targetId)) {
                return "❌ Cette personne fait déjà partie d'un clan !";
            }
            
            if (inviterClan.members.length >= 20) {
                return "❌ Ton clan est plein ! (Maximum 20 membres)";
            }
            
            if (!clanData.invitations[targetId]) {
                clanData.invitations[targetId] = [];
            }
            
            if (clanData.invitations[targetId].includes(inviterClan.id)) {
                return "❌ Tu as déjà invité cette personne !";
            }
            
            clanData.invitations[targetId].push(inviterClan.id);
            saveClanData(clanData);
            
            return `📨 Invitation envoyée à ${targetUser} !\n` +
                   `Il peut rejoindre avec: /clan join ${inviterClan.name}\n` +
                   `Ou avec l'ID: /clan join id:${inviterClan.id}`;

        case 'invitations':
            const userInvites = clanData.invitations[userId] || [];
            if (userInvites.length === 0) {
                return "📪 Tu n'as aucune invitation en attente.";
            }
            
            let inviteList = "📬 **TES INVITATIONS**\n\n";
            userInvites.forEach((clanId, index) => {
                const clan = clanData.clans[clanId];
                if (clan) {
                    inviteList += `${index + 1}. **${clan.name}** ${clan.emblem}\n`;
                    inviteList += `   🆔 ID: \`${clanId}\`\n`;
                    inviteList += `   👥 ${clan.members.length}/20 membres | ⭐ Niv.${clan.level}\n`;
                    inviteList += `   💬 "${clan.slogan}"\n\n`;
                }
            });
            
            inviteList += `Pour rejoindre: /clan join [nom] ou /clan join id:[ID]`;
            return inviteList;

        case 'join':
        case 'rejoindre':
            const joinArg = args_parts.slice(1).join(' ');
            if (!joinArg) {
                const userInvites = clanData.invitations[userId] || [];
                if (userInvites.length === 0) {
                    return "❌ Tu n'as aucune invitation ! Usage: /clan join [nom du clan] ou /clan join id:[ID]";
                }
                
                return "📬 Tu as des invitations ! Utilise `/clan invitations` pour les voir.";
            }
            
            if (getUserClan(userId)) {
                return "❌ Tu fais déjà partie d'un clan !";
            }
            
            let joinClan = null;
            let joinClanId = null;
            
            // Vérifier si c'est un ID (format id:xxxxx)
            if (joinArg.startsWith('id:')) {
                joinClanId = joinArg.substring(3);
                joinClan = findClanById(joinClanId);
            } else {
                // Recherche par nom
                joinClan = findClanByName(joinArg);
                if (joinClan) {
                    joinClanId = joinClan.id;
                }
            }
            
            if (!joinClan) {
                return "❌ Clan introuvable ! Vérifie le nom ou l'ID.";
            }
            
            // Vérifier l'invitation
            if (!clanData.invitations[userId]?.includes(joinClanId)) {
                return "❌ Tu n'as pas d'invitation pour ce clan !";
            }
            
            if (joinClan.members.length >= 20) {
                return "❌ Ce clan est plein !";
            }
            
            // Rejoindre le clan
            joinClan.members.push(userId);
            clanData.userClans[userId] = joinClanId;
            
            // Supprimer l'invitation
            clanData.invitations[userId] = clanData.invitations[userId].filter(
                id => id !== joinClanId
            );
            
            saveClanData(clanData);
            return `🎉 Tu as rejoint le clan "${joinClan.name}" ${joinClan.emblem} !\n` +
                   `👥 Membres: ${joinClan.members.length}/20\n` +
                   `💬 "${joinClan.slogan}"`;

        case 'search':
        case 'recherche':
            const keyword = args_parts.slice(1).join(' ').toLowerCase();
            if (!keyword) {
                return "⚔️ Usage: /clan search [mot-clé]\n\nExemple: /clan search dragon";
            }
            
            const matchingClans = Object.values(clanData.clans).filter(clan => 
                clan.name.toLowerCase().includes(keyword) ||
                clan.description.toLowerCase().includes(keyword) ||
                clan.slogan.toLowerCase().includes(keyword)
            ).slice(0, 10);
            
            if (matchingClans.length === 0) {
                return `❌ Aucun clan trouvé avec le mot-clé: "${keyword}"`;
            }
            
            let searchResults = `🔍 **RÉSULTATS POUR "${keyword.toUpperCase()}"**\n\n`;
            matchingClans.forEach((clan, index) => {
                searchResults += `${index + 1}. **${clan.name}** ${clan.emblem}\n`;
                searchResults += `   🆔 ID: \`${clan.id}\`\n`;
                searchResults += `   👥 ${clan.members.length}/20 | ⭐ Niv.${clan.level} | 💰 ${clan.treasury}\n`;
                searchResults += `   💬 "${clan.slogan}"\n\n`;
            });
            
            return searchResults;

        case 'leave':
        case 'quitter':
            const leaveClan = getUserClan(userId);
            if (!leaveClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            const leaveClanId = clanData.userClans[userId];
            
            if (isLeader(userId, leaveClanId)) {
                if (leaveClan.members.length > 1) {
                    return "❌ Tu ne peux pas quitter ton clan tant qu'il y a d'autres membres !\nUtilise `/clan disband` pour dissoudre le clan ou `/clan promote @membre` pour promouvoir un nouveau chef.";
                } else {
                    // Dissoudre le clan automatiquement
                    const normalizedName = normalizeName(leaveClan.name);
                    delete clanData.clans[leaveClanId];
                    delete clanData.userClans[userId];
                    delete clanData.battleHistory[leaveClanId];
                    delete clanData.clanNames[normalizedName];
                    saveClanData(clanData);
                    return "🏰 Clan dissous ! Tu n'as plus de clan.";
                }
            } else {
                // Retirer le membre
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete clanData.userClans[userId];
                saveClanData(clanData);
                return `👋 Tu as quitté le clan "${leaveClan.name}".`;
            }

        case 'battle':
        case 'attaque':
            const targetClanArg = args_parts.slice(1).join(' ');
            const attackerClan = getUserClan(userId);
            
            if (!attackerClan) {
                return "❌ Tu dois faire partie d'un clan pour lancer une bataille !";
            }
            
            if (!targetClanArg) {
                return "⚔️ Usage: /clan battle [nom du clan ennemi] ou /clan battle id:[ID]";
            }
            
            let enemyClan = null;
            let enemyClanId = null;
            
            // Vérifier si c'est un ID
            if (targetClanArg.startsWith('id:')) {
                enemyClanId = targetClanArg.substring(3);
                enemyClan = findClanById(enemyClanId);
            } else {
                enemyClan = findClanByName(targetClanArg);
                if (enemyClan) {
                    enemyClanId = enemyClan.id;
                }
            }
            
            if (!enemyClan) {
                return "❌ Clan ennemi introuvable !";
            }
            
            const attackerClanId = clanData.userClans[userId];
            
            if (attackerClanId === enemyClanId) {
                return "❌ Tu ne peux pas attaquer ton propre clan !";
            }
            
            // Vérifier la protection post-défaite
            if (isProtectedFromAttack(enemyClan)) {
                const timeLeft = getProtectionTimeLeft(enemyClan);
                return `🛡️ Ce clan est protégé suite à une récente défaite !\nProtection restante: ${formatTime(timeLeft)}`;
            }
            
            // Vérifier s'il y a déjà une bataille en cours
            const existingBattle = Object.values(clanData.battles).find(
                battle => (battle.attacker === attackerClanId && battle.defender === enemyClanId) ||
                          (battle.attacker === enemyClanId && battle.defender === attackerClanId)
            );
            
            if (existingBattle) {
                return "⚔️ Il y a déjà une bataille en cours entre ces clans !";
            }
            
            // Calculer la puissance des clans avec le nouveau système
            const attackerPower = calculateClanPower(attackerClan);
            const defenderPower = calculateClanPower(enemyClan);
            
            const battleId = generateUniqueId('battle');
            const victory = attackerPower > defenderPower;
            
            // Calculs des gains/pertes
            const xpGain = victory ? 200 : 50;
            const goldChange = victory ? 150 : -75;
            const enemyGoldChange = victory ? -100 : 100;
            const enemyXpGain = victory ? 50 : 150;
            
            // Appliquer les changements
            const levelUp = addXP(attackerClanId, xpGain);
            const enemyLevelUp = addXP(enemyClanId, enemyXpGain);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGoldChange);
            
            // Appliquer la protection en cas de défaite
            if (!victory) {
                attackerClan.lastDefeat = Date.now();
            } else {
                enemyClan.lastDefeat = Date.now();
            }
            
            // Pertes d'unités (aléatoires)
            const attackerLosses = {
                warriors: Math.floor(Math.random() * 3),
                archers: Math.floor(Math.random() * 2),
                mages: Math.floor(Math.random() * 1)
            };
            
            const defenderLosses = {
                warriors: Math.floor(Math.random() * (victory ? 5 : 2)),
                archers: Math.floor(Math.random() * (victory ? 3 : 1)),
                mages: Math.floor(Math.random() * (victory ? 2 : 1))
            };
            
            // Appliquer les pertes
            attackerClan.units.warriors = Math.max(0, attackerClan.units.warriors - attackerLosses.warriors);
            attackerClan.units.archers = Math.max(0, attackerClan.units.archers - attackerLosses.archers);
            attackerClan.units.mages = Math.max(0, attackerClan.units.mages - attackerLosses.mages);
            
            enemyClan.units.warriors = Math.max(0, enemyClan.units.warriors - defenderLosses.warriors);
            enemyClan.units.archers = Math.max(0, enemyClan.units.archers - defenderLosses.archers);
            enemyClan.units.mages = Math.max(0, enemyClan.units.mages - defenderLosses.mages);
            
            // Enregistrer la bataille
            const battleResult = {
                id: battleId,
                attacker: attackerClanId,
                defender: enemyClanId,
                status: 'completed',
                result: victory ? 'attacker_victory' : 'defender_victory',
                timestamp: Date.now(),
                attackerPower: Math.round(attackerPower),
                defenderPower: Math.round(defenderPower),
                details: {
                    attackerLosses,
                    defenderLosses,
                    xpGained: { attacker: xpGain, defender: enemyXpGain },
                    goldChanged: { attacker: goldChange, defender: enemyGoldChange }
                }
            };
            
            clanData.battles[battleId] = battleResult;
            
            // Ajouter à l'historique
            if (!clanData.battleHistory[attackerClanId]) clanData.battleHistory[attackerClanId] = [];
            if (!clanData.battleHistory[enemyClanId]) clanData.battleHistory[enemyClanId] = [];
            
            clanData.battleHistory[attackerClanId].push(battleResult);
            clanData.battleHistory[enemyClanId].push(battleResult);
            
            saveClanData(clanData);
            
            let result = `⚔️ **BATAILLE TERMINÉE** ⚔️\n\n`;
            result += `🏰 ${attackerClan.name} VS ${enemyClan.name}\n`;
            result += `💪 Puissance: ${Math.round(attackerPower)} vs ${Math.round(defenderPower)}\n\n`;
            
            if (victory) {
                result += `🎉 **VICTOIRE DE ${attackerClan.name.toUpperCase()}** !\n`;
                result += `✨ +${xpGain} XP | 💰 +${goldChange} pièces\n`;
                result += `${levelUp ? '🆙 NIVEAU SUPÉRIEUR ! 🆙\n' : ''}`;
                result += `💀 Pertes: ${attackerLosses.warriors}⚔️ ${attackerLosses.archers}🏹 ${attackerLosses.mages}🔮\n`;
                result += `\n${enemyClan.name}: +${enemyXpGain} XP | ${enemyGoldChange} pièces\n`;
                result += `💀 Pertes ennemies: ${defenderLosses.warriors}⚔️ ${defenderLosses.archers}🏹 ${defenderLosses.mages}🔮\n`;
                result += `🛡️ ${enemyClan.name} est protégé 2h`;
            } else {
                result += `🛡️ **${enemyClan.name.toUpperCase()} RÉSISTE** !\n`;
                result += `✨ +${xpGain} XP | 💰 ${goldChange} pièces\n`;
                result += `💀 Pertes: ${attackerLosses.warriors}⚔️ ${attackerLosses.archers}🏹 ${attackerLosses.mages}🔮\n`;
                result += `\n${enemyClan.name}: +${enemyXpGain} XP | +${enemyGoldChange} pièces`;
                result += `${enemyLevelUp ? '\n🆙 ' + enemyClan.name + ' NIVEAU SUPÉRIEUR ! 🆙' : ''}`;
                result += `\n💀 Pertes défensives: ${defenderLosses.warriors}⚔️ ${defenderLosses.archers}🏹 ${defenderLosses.mages}🔮`;
                result += `\n🛡️ Tu es protégé 2h`;
            }
            
            return result;

        case 'list':
        case 'liste':
            const allClans = Object.values(clanData.clans)
                .sort((a, b) => b.level - a.level || b.xp - a.xp)
                .slice(0, 10);
            
            if (allClans.length === 0) {
                return "❌ Aucun clan n'existe encore ! Crée le premier avec `/clan create [nom]`";
            }
            
            let clanList = "🏆 **TOP CLANS** 🏆\n\n";
            allClans.forEach((clan, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const protection = isProtectedFromAttack(clan) ? '🛡️' : '';
                clanList += `${medal} **${clan.name}** ${clan.emblem} ${protection}\n`;
                clanList += `   🆔 \`${clan.id}\` | ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20 | 💰 ${clan.treasury}\n`;
                clanList += `   💬 "${clan.slogan}"\n\n`;
            });
            
            clanList += `🛡️ = Clan protégé | Pour rejoindre: /clan join id:[ID]`;
            
            return clanList;

        case 'promote':
        case 'promouvoir':
            const promoteClan = getUserClan(userId);
            if (!promoteClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            if (!isLeader(userId, clanData.userClans[userId])) {
                return "❌ Seul le chef de clan peut promouvoir quelqu'un !";
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                return "⚔️ Usage: /clan promote @nouveau_chef";
            }
            
            if (!promoteClan.members.includes(newLeader)) {
                return "❌ Cette personne ne fait pas partie de ton clan !";
            }
            
            if (newLeader === userId) {
                return "❌ Tu es déjà le chef !";
            }
            
            promoteClan.leader = newLeader;
            saveClanData(clanData);
            
            return `👑 ${args_parts[1]} est maintenant le nouveau chef de **${promoteClan.name}** !\nTu es maintenant un membre ordinaire.`;

        case 'kick':
        case 'exclure':
            const kickClan = getUserClan(userId);
            if (!kickClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            if (!isLeader(userId, clanData.userClans[userId])) {
                return "❌ Seul le chef de clan peut exclure des membres !";
            }
            
            const kickUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!kickUser) {
                return "⚔️ Usage: /clan kick @utilisateur";
            }
            
            if (kickUser === userId) {
                return "❌ Tu ne peux pas t'exclure toi-même ! Utilise `/clan leave`.";
            }
            
            if (!kickClan.members.includes(kickUser)) {
                return "❌ Cette personne ne fait pas partie de ton clan !";
            }
            
            kickClan.members = kickClan.members.filter(id => id !== kickUser);
            delete clanData.userClans[kickUser];
            saveClanData(clanData);
            
            return `🚪 ${args_parts[1]} a été exclu du clan **${kickClan.name}**.`;

        case 'disband':
        case 'dissoudre':
            const disbandClan = getUserClan(userId);
            if (!disbandClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            if (!isLeader(userId, clanData.userClans[userId])) {
                return "❌ Seul le chef de clan peut dissoudre le clan !";
            }
            
            const disbandClanId = clanData.userClans[userId];
            const disbandClanName = disbandClan.name;
            const normalizedDisbandName = normalizeName(disbandClan.name);
            
            // Retirer tous les membres
            disbandClan.members.forEach(memberId => {
                delete clanData.userClans[memberId];
            });
            
            // Supprimer le clan
            delete clanData.clans[disbandClanId];
            delete clanData.battleHistory[disbandClanId];
            delete clanData.clanNames[normalizedDisbandName];
            
            // Nettoyer les invitations
            Object.keys(clanData.invitations).forEach(userId => {
                clanData.invitations[userId] = clanData.invitations[userId].filter(
                    id => id !== disbandClanId
                );
            });
            
            saveClanData(clanData);
            return `💥 Le clan **${disbandClanName}** a été dissous ! Tous les membres ont été libérés.`;

        case 'customize':
        case 'personnaliser':
            const customizeClan = getUserClan(userId);
            if (!customizeClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            if (!isLeader(userId, clanData.userClans[userId])) {
                return "❌ Seul le chef de clan peut personnaliser le clan !";
            }
            
            const customType = args_parts[1]?.toLowerCase();
            const customValue = args_parts.slice(2).join(' ');
            
            if (!customType || !customValue) {
                return "⚔️ Usage: /clan customize [slogan|emblem|description] [valeur]\n\n" +
                       "Exemples:\n" +
                       "• /clan customize slogan Victoire ou mort !\n" +
                       "• /clan customize emblem 🐉\n" +
                       "• /clan customize description Les plus fiers guerriers du royaume";
            }
            
            switch (customType) {
                case 'slogan':
                    if (customValue.length > 100) {
                        return "❌ Le slogan ne peut pas dépasser 100 caractères !";
                    }
                    customizeClan.slogan = customValue;
                    saveClanData(clanData);
                    return `✨ Nouveau slogan défini: "${customValue}"`;
                    
                case 'emblem':
                case 'emblème':
                    if (customValue.length > 5) {
                        return "❌ L'emblème ne peut pas dépasser 5 caractères !";
                    }
                    customizeClan.emblem = customValue;
                    saveClanData(clanData);
                    return `🎨 Nouvel emblème défini: ${customValue}`;
                    
                case 'description':
                    if (customValue.length > 200) {
                        return "❌ La description ne peut pas dépasser 200 caractères !";
                    }
                    customizeClan.description = customValue;
                    saveClanData(clanData);
                    return `📝 Nouvelle description définie: "${customValue}"`;
                    
                default:
                    return "❌ Type de personnalisation invalide ! Utilise: slogan, emblem, ou description";
            }

        case 'units':
        case 'unités':
            const unitsClan = getUserClan(userId);
            if (!unitsClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            const unitsAction = args_parts[1]?.toLowerCase();
            
            if (!unitsAction) {
                return `⚔️ **UNITÉS DE ${unitsClan.name.toUpperCase()}**\n\n` +
                       `🗡️ Guerriers: ${unitsClan.units.warriors} (15 pts puissance)\n` +
                       `🏹 Archers: ${unitsClan.units.archers} (12 pts puissance)\n` +
                       `🔮 Mages: ${unitsClan.units.mages} (20 pts puissance)\n\n` +
                       `💪 Puissance totale unités: ${(unitsClan.units.warriors * 15) + (unitsClan.units.archers * 12) + (unitsClan.units.mages * 20)}\n` +
                       `💰 Trésorerie: ${unitsClan.treasury} pièces\n\n` +
                       `Pour recruter: /clan units buy [type] [nombre]\n` +
                       `Prix: Guerrier 50💰 | Archer 75💰 | Mage 100💰`;
            }
            
            if (unitsAction === 'buy' || unitsAction === 'acheter') {
                if (!isLeader(userId, clanData.userClans[userId])) {
                    return "❌ Seul le chef de clan peut recruter des unités !";
                }
                
                const unitType = args_parts[2]?.toLowerCase();
                const quantity = parseInt(args_parts[3]) || 1;
                
                if (!unitType || quantity <= 0) {
                    return "⚔️ Usage: /clan units buy [guerrier/archer/mage] [nombre]";
                }
                
                let cost = 0;
                let unitName = '';
                
                switch (unitType) {
                    case 'guerrier':
                    case 'guerriers':
                    case 'warrior':
                        cost = 50 * quantity;
                        unitName = 'guerriers';
                        break;
                    case 'archer':
                    case 'archers':
                        cost = 75 * quantity;
                        unitName = 'archers';
                        break;
                    case 'mage':
                    case 'mages':
                        cost = 100 * quantity;
                        unitName = 'mages';
                        break;
                    default:
                        return "❌ Type d'unité invalide ! Utilise: guerrier, archer, ou mage";
                }
                
                if (unitsClan.treasury < cost) {
                    return `❌ Fonds insuffisants ! Coût: ${cost} pièces, Disponible: ${unitsClan.treasury} pièces`;
                }
                
                // Effectuer l'achat
                unitsClan.treasury -= cost;
                switch (unitType) {
                    case 'guerrier':
                    case 'guerriers':
                    case 'warrior':
                        unitsClan.units.warriors += quantity;
                        break;
                    case 'archer':
                    case 'archers':
                        unitsClan.units.archers += quantity;
                        break;
                    case 'mage':
                    case 'mages':
                        unitsClan.units.mages += quantity;
                        break;
                }
                
                saveClanData(clanData);
                return `✅ ${quantity} ${unitName} recruté(s) pour ${cost} pièces !\n` +
                       `💰 Trésorerie restante: ${unitsClan.treasury} pièces`;
            }
            
            return "❌ Action invalide ! Utilise: /clan units ou /clan units buy [type] [nombre]";

        case 'history':
        case 'historique':
            const historyClan = getUserClan(userId);
            if (!historyClan) {
                return "❌ Tu ne fais partie d'aucun clan !";
            }
            
            const history = clanData.battleHistory[historyClan.id] || [];
            if (history.length === 0) {
                return "📜 Aucune bataille dans l'historique de ton clan.";
            }
            
            let historyText = `📜 **HISTORIQUE DE ${historyClan.name.toUpperCase()}**\n\n`;
            const recentBattles = history.slice(-5).reverse();
            
            recentBattles.forEach((battle, index) => {
                const isAttacker = battle.attacker === historyClan.id;
                const enemyClan = isAttacker ? 
                    clanData.clans[battle.defender] : 
                    clanData.clans[battle.attacker];
                
                const won = (isAttacker && battle.result === 'attacker_victory') ||
                           (!isAttacker && battle.result === 'defender_victory');
                
                const date = new Date(battle.timestamp).toLocaleDateString();
                const role = isAttacker ? 'Attaque' : 'Défense';
                const result = won ? '🏆 Victoire' : '💀 Défaite';
                
                historyText += `${index + 1}. ${result} | ${role} vs ${enemyClan?.name || 'Clan supprimé'}\n`;
                historyText += `   📅 ${date} | 💪 ${isAttacker ? battle.attackerPower : battle.defenderPower} pts\n\n`;
            });
            
            return historyText;

        case 'help':
        case 'aide':
            return `⚔️ **COMMANDES CLAN** ⚔️\n\n` +
                   `🏰 **Gestion:**\n` +
                   `• /clan create [nom] - Créer un clan\n` +
                   `• /clan info - Infos de ton clan\n` +
                   `• /clan list - Top des clans (avec IDs)\n` +
                   `• /clan search [mot-clé] - Rechercher un clan\n\n` +
                   `👥 **Membres:**\n` +
                   `• /clan invite @user - Inviter\n` +
                   `• /clan invitations - Voir tes invitations\n` +
                   `• /clan join [nom/id:ID] - Rejoindre\n` +
                   `• /clan leave - Quitter\n` +
                   `• /clan kick @user - Exclure (chef)\n` +
                   `• /clan promote @user - Promouvoir (chef)\n\n` +
                   `⚔️ **Combat:**\n` +
                   `• /clan battle [nom/id:ID] - Attaquer\n` +
                   `• /clan units - Voir/acheter unités\n` +
                   `• /clan history - Historique batailles\n\n` +
                   `🎨 **Personnalisation (chef):**\n` +
                   `• /clan customize slogan [texte]\n` +
                   `• /clan customize emblem [emoji]\n` +
                   `• /clan customize description [texte]\n\n` +
                   `🔥 **Admin:**\n` +
                   `• /clan disband - Dissoudre (chef)`;

        default:
            if (!args.trim()) {
                const userClan = getUserClan(userId);
                if (userClan) {
                    const protection = isProtectedFromAttack(userClan) ? 
                        `🛡️ Protégé ${formatTime(getProtectionTimeLeft(userClan))}` : '';
                    return `🏰 **${userClan.name}** ${userClan.emblem} (Niv.${userClan.level})\n` +
                           `🆔 ID: \`${userClan.id}\`\n` +
                           `👥 ${userClan.members.length}/20 membres | 💰 ${userClan.treasury} pièces\n` +
                           `💬 "${userClan.slogan}"\n` +
                           `${protection}\n\n` +
                           `Tape \`/clan help\` pour toutes les commandes !`;
                } else {
                    return `⚔️ **SYSTÈME DE CLANS** ⚔️\n\nTu n'as pas de clan !\n\n` +
                           `🏰 Crée ton clan: \`/clan create [nom]\`\n` +
                           `🔍 Rechercher: \`/clan search [mot-clé]\`\n` +
                           `📜 Voir tous les clans: \`/clan list\`\n` +
                           `❓ Aide complète: \`/clan help\``;
                }
            } else {
                return `❌ Commande inconnue: "${action}"\nUtilise \`/clan help\` pour voir toutes les commandes disponibles.`;
            }
    }
};
