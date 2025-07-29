/**
 * Commande /clan - Système de gestion de clans avec batailles
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, saveDataToGitHub, loadDataFromGitHub } = ctx;
    
    // Structure des données de clan
    const initializeClanData = () => ({
        clans: {}, // {clanId: {name, leader, members: [], level, xp, treasury, creation_date}}
        userClans: {}, // {userId: clanId}
        battles: {}, // {battleId: {attacker, defender, status, result, timestamp}}
        invitations: {}, // {userId: [clanIds]}
        battleHistory: {} // {clanId: [battles]} - nettoyé périodiquement
    });
    
    // Gestion du stockage persistant des clans
    let clanData;
    
    // Charger les données de clan depuis le contexte global
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
    
    // Fonctions utilitaires
    const getUserClan = (userId) => {
        const clanId = clanData.userClans[userId];
        return clanId ? clanData.clans[clanId] : null;
    };
    
    const isLeader = (userId, clanId) => {
        return clanData.clans[clanId]?.leader === userId;
    };
    
    const generateClanId = (name) => {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now();
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
            
            // Vérifier si le nom existe déjà
            const existingClan = Object.values(clanData.clans).find(
                clan => clan.name.toLowerCase() === newClanName.toLowerCase()
            );
            if (existingClan) {
                return "❌ Un clan avec ce nom existe déjà ! Choisis un autre nom.";
            }
            
            const clanId = generateClanId(newClanName);
            clanData.clans[clanId] = {
                name: newClanName,
                leader: userId,
                members: [userId],
                level: 1,
                xp: 0,
                treasury: 100,
                creation_date: Date.now(),
                description: "Un nouveau clan prometteur !"
            };
            clanData.userClans[userId] = clanId;
            clanData.battleHistory[clanId] = [];
            
            saveClanData(clanData);
            return `🎉 Clan "${newClanName}" créé avec succès !\n👑 Tu es maintenant le chef de clan.\n💰 Trésorerie: 100 pièces\n⭐ Niveau: 1\n\nUtilise /clan help pour voir toutes tes options !`;

        case 'info':
            const userClan = getUserClan(userId);
            if (!userClan) {
                return "❌ Tu ne fais partie d'aucun clan ! Crée-en un avec `/clan create [nom]`";
            }
            
            const memberCount = userClan.members.length;
            const nextLevelXP = (userClan.level * 1000) - userClan.xp;
            
            return `🏰 **${userClan.name}**\n` +
                   `👑 Chef: ${userClan.leader === userId ? 'Toi' : `<@${userClan.leader}>`}\n` +
                   `👥 Membres: ${memberCount}/20\n` +
                   `⭐ Niveau: ${userClan.level}\n` +
                   `✨ XP: ${userClan.xp} (${nextLevelXP} pour le niveau suivant)\n` +
                   `💰 Trésorerie: ${userClan.treasury} pièces\n` +
                   `📝 ${userClan.description}`;

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
            
            if (clanData.invitations[targetId].includes(clanData.userClans[userId])) {
                return "❌ Tu as déjà invité cette personne !";
            }
            
            clanData.invitations[targetId].push(clanData.userClans[userId]);
            saveClanData(clanData);
            
            return `📨 Invitation envoyée à ${targetUser} !\nIl peut rejoindre avec: /clan join ${inviterClan.name}`;

        case 'join':
        case 'rejoindre':
            const joinClanName = args_parts.slice(1).join(' ');
            if (!joinClanName) {
                const userInvites = clanData.invitations[userId] || [];
                if (userInvites.length === 0) {
                    return "❌ Tu n'as aucune invitation ! Usage: /clan join [nom du clan]";
                }
                
                const inviteList = userInvites.map(clanId => 
                    `• ${clanData.clans[clanId].name}`
                ).join('\n');
                
                return `📬 Tes invitations:\n${inviteList}\n\nUtilise: /clan join [nom du clan]`;
            }
            
            if (getUserClan(userId)) {
                return "❌ Tu fais déjà partie d'un clan !";
            }
            
            const joinClan = Object.values(clanData.clans).find(
                clan => clan.name.toLowerCase() === joinClanName.toLowerCase()
            );
            
            if (!joinClan) {
                return "❌ Clan introuvable ! Vérifie le nom.";
            }
            
            const joinClanId = Object.keys(clanData.clans).find(
                id => clanData.clans[id] === joinClan
            );
            
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
            return `🎉 Tu as rejoint le clan "${joinClan.name}" !\n👥 Membres: ${joinClan.members.length}/20`;

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
                    delete clanData.clans[leaveClanId];
                    delete clanData.userClans[userId];
                    delete clanData.battleHistory[leaveClanId];
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
            const targetClanName = args_parts.slice(1).join(' ');
            const attackerClan = getUserClan(userId);
            
            if (!attackerClan) {
                return "❌ Tu dois faire partie d'un clan pour lancer une bataille !";
            }
            
            if (!targetClanName) {
                return "⚔️ Usage: /clan battle [nom du clan ennemi]";
            }
            
            const enemyClan = Object.values(clanData.clans).find(
                clan => clan.name.toLowerCase() === targetClanName.toLowerCase()
            );
            
            if (!enemyClan) {
                return "❌ Clan ennemi introuvable !";
            }
            
            const attackerClanId = clanData.userClans[userId];
            const enemyClanId = Object.keys(clanData.clans).find(
                id => clanData.clans[id] === enemyClan
            );
            
            if (attackerClanId === enemyClanId) {
                return "❌ Tu ne peux pas attaquer ton propre clan !";
            }
            
            // Vérifier s'il y a déjà une bataille en cours
            const existingBattle = Object.values(clanData.battles).find(
                battle => (battle.attacker === attackerClanId && battle.defender === enemyClanId) ||
                          (battle.attacker === enemyClanId && battle.defender === attackerClanId)
            );
            
            if (existingBattle) {
                return "⚔️ Il y a déjà une bataille en cours entre ces clans !";
            }
            
            // Calculer la puissance des clans
            const attackerPower = attackerClan.level * 100 + attackerClan.members.length * 50 + Math.random() * 200;
            const defenderPower = enemyClan.level * 100 + enemyClan.members.length * 50 + Math.random() * 200;
            
            const battleId = `battle_${Date.now()}`;
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
            
            // Enregistrer la bataille
            const battleResult = {
                attacker: attackerClanId,
                defender: enemyClanId,
                status: 'completed',
                result: victory ? 'attacker_victory' : 'defender_victory',
                timestamp: Date.now(),
                attackerPower: Math.round(attackerPower),
                defenderPower: Math.round(defenderPower)
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
                result += `\n${enemyClan.name}: +${enemyXpGain} XP | ${enemyGoldChange} pièces`;
            } else {
                result += `🛡️ **${enemyClan.name.toUpperCase()} RÉSISTE** !\n`;
                result += `✨ +${xpGain} XP | 💰 ${goldChange} pièces\n`;
                result += `\n${enemyClan.name}: +${enemyXpGain} XP | +${enemyGoldChange} pièces`;
                result += `${enemyLevelUp ? '\n🆙 ' + enemyClan.name + ' NIVEAU SUPÉRIEUR ! 🆙' : ''}`;
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
                clanList += `${medal} **${clan.name}**\n`;
                clanList += `   ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20 | 💰 ${clan.treasury}\n\n`;
            });
            
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
            
            // Retirer tous les membres
            disbandClan.members.forEach(memberId => {
                delete clanData.userClans[memberId];
            });
            
            // Supprimer le clan
            delete clanData.clans[disbandClanId];
            delete clanData.battleHistory[disbandClanId];
            
            // Nettoyer les invitations
            Object.keys(clanData.invitations).forEach(userId => {
                clanData.invitations[userId] = clanData.invitations[userId].filter(
                    id => id !== disbandClanId
                );
            });
            
            saveClanData(clanData);
            return `💥 Le clan **${disbandClanName}** a été dissous ! Tous les membres ont été libérés.`;

        case 'help':
        case 'aide':
            return `⚔️ **COMMANDES CLAN** ⚔️\n\n` +
                   `🏰 **Gestion:**\n` +
                   `• /clan create [nom] - Créer un clan\n` +
                   `• /clan info - Infos de ton clan\n` +
                   `• /clan list - Top des clans\n\n` +
                   `👥 **Membres:**\n` +
                   `• /clan invite @user - Inviter\n` +
                   `• /clan join [nom] - Rejoindre\n` +
                   `• /clan leave - Quitter\n` +
                   `• /clan kick @user - Exclure (chef)\n` +
                   `• /clan promote @user - Promouvoir (chef)\n\n` +
                   `⚔️ **Combat:**\n` +
                   `• /clan battle [nom clan] - Attaquer\n\n` +
                   `🔥 **Admin:**\n` +
                   `• /clan disband - Dissoudre (chef)`;

        default:
            if (!args.trim()) {
                const userClan = getUserClan(userId);
                if (userClan) {
                    return `🏰 **${userClan.name}** (Niv.${userClan.level})\n👥 ${userClan.members.length}/20 membres\n💰 ${userClan.treasury} pièces\n\nTape \`/clan help\` pour toutes les commandes !`;
                } else {
                    return `⚔️ **SYSTÈME DE CLANS** ⚔️\n\nTu n'as pas de clan !\n\n🏰 Crée ton clan: \`/clan create [nom]\`\n📜 Voir tous les clans: \`/clan list\`\n❓ Aide complète: \`/clan help\``;
                }
            } else {
                return `❌ Commande inconnue: "${action}"\nUtilise \`/clan help\` pour voir toutes les commandes disponibles.`;
            }
    }
};
