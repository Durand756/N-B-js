/**
 * Commande /clan - Système de gestion de clans optimisé avec vérifications avancées
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, saveDataImmediate, sendMessage } = ctx;
    
    // Initialisation des données avec nouvelles structures
    const initClanData = () => ({
        clans: {}, // {id: {id, name, leader, members: [], level, xp, treasury, units: {w, a, m}, lastDefeat, lastBattles: {clanId: timestamp}}}
        userClans: {}, // {userId: clanId}
        battles: {}, // Historique complet des batailles
        invites: {}, // {userId: [clanIds]}
        deletedClans: {}, // {userId: deleteTimestamp} - cooldown 3 jours
        battleStats: {}, // Statistiques globales
        counter: 0
    });
    
    if (!ctx.clanData) {
        ctx.clanData = initClanData();
        await saveDataImmediate();
        ctx.log.info("🏰 Structure des clans initialisée avec vérifications avancées");
    }
    let data = ctx.clanData;
    
    const userId = String(senderId);
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    
    // === CONSTANTES DE JEU ===
    const GAME_CONFIG = {
        MAX_MEMBERS: 20,
        COOLDOWN_BETWEEN_SAME_CLANS: 60 * 60 * 1000, // 1h entre combats contre le même clan
        PROTECTION_TIME: 60 * 60 * 1000, // 1h de protection après défaite
        CREATION_COOLDOWN: 3 * 24 * 60 * 60 * 1000, // 3 jours
        XP_PER_LEVEL: 1000,
        UNIT_COSTS: { w: 40, a: 60, m: 80 },
        UNIT_POWER: { w: 10, a: 8, m: 15 },
        BATTLE_REWARDS: {
            victory: { xp: 200, gold: 100 },
            draw: { xp: 100, gold: 0 },
            defeat: { xp: 50, gold: -50 }
        }
    };
    
    // === UTILITAIRES AVANCÉS ===
    
    // Génération d'IDs courts sécurisés
    const generateId = (type) => {
        data.counter = (data.counter || 0) + 1;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let id = '';
        let num = data.counter + Date.now() % 10000;
        
        for (let i = 0; i < (type === 'clan' ? 4 : 3); i++) {
            id = chars[num % chars.length] + id;
            num = Math.floor(num / chars.length);
        }
        
        // Vérifier l'unicité
        if (type === 'clan' && data.clans[id]) {
            return generateId(type); // Récursion si collision
        }
        return id;
    };
    
    const getUserClan = () => {
        const clanId = data.userClans[userId];
        return clanId ? data.clans[clanId] : null;
    };
    
    const findClan = (nameOrId) => {
        // Recherche par ID exact
        if (data.clans[nameOrId.toUpperCase()]) {
            return data.clans[nameOrId.toUpperCase()];
        }
        // Recherche par nom (insensible à la casse)
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
        return (Date.now() - deleteTime) > GAME_CONFIG.CREATION_COOLDOWN;
    };
    
    const getCooldownTime = () => {
        const deleteTime = data.deletedClans[userId];
        if (!deleteTime) return 0;
        return GAME_CONFIG.CREATION_COOLDOWN - (Date.now() - deleteTime);
    };
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        
        if (days > 0) return `${days}j ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };
    
    // Calcul de puissance amélioré avec bonus de niveau
    const calculatePower = (clan) => {
        if (!clan) return 0;
        
        // Base: niveau avec bonus exponentiel
        const levelBonus = clan.level * 100 + Math.pow(clan.level, 1.2) * 10;
        
        // Membres avec bonus de synergie
        const memberBonus = clan.members.length * 30;
        const synergyBonus = clan.members.length >= 10 ? clan.members.length * 5 : 0;
        
        // Unités avec efficacité
        const unitPower = clan.units.w * GAME_CONFIG.UNIT_POWER.w + 
                         clan.units.a * GAME_CONFIG.UNIT_POWER.a + 
                         clan.units.m * GAME_CONFIG.UNIT_POWER.m;
        
        // Bonus XP progressif
        const xpBonus = Math.floor(clan.xp / 100) * 5;
        
        // Bonus de diversité d'unités
        const unitTypes = [clan.units.w > 0, clan.units.a > 0, clan.units.m > 0].filter(Boolean).length;
        const diversityBonus = unitTypes * 20;
        
        return Math.floor(levelBonus + memberBonus + synergyBonus + unitPower + xpBonus + diversityBonus);
    };
    
    // Vérifications de protection et cooldown
    const isProtected = (clan) => {
        if (!clan.lastDefeat) return false;
        return (Date.now() - clan.lastDefeat) < GAME_CONFIG.PROTECTION_TIME;
    };
    
    const canBattleAgainst = (attackerClan, defenderClan) => {
        if (!attackerClan.lastBattles) attackerClan.lastBattles = {};
        const lastBattle = attackerClan.lastBattles[defenderClan.id];
        if (!lastBattle) return true;
        return (Date.now() - lastBattle) > GAME_CONFIG.COOLDOWN_BETWEEN_SAME_CLANS;
    };
    
    const getNextBattleTime = (attackerClan, defenderClan) => {
        if (!attackerClan.lastBattles) return 0;
        const lastBattle = attackerClan.lastBattles[defenderClan.id];
        if (!lastBattle) return 0;
        return GAME_CONFIG.COOLDOWN_BETWEEN_SAME_CLANS - (Date.now() - lastBattle);
    };
    
    // Système XP avec vérification de niveau
    const addXP = (clan, amount) => {
        if (!clan || amount <= 0) return false;
        
        const oldLevel = clan.level;
        clan.xp += amount;
        const newLevel = Math.floor(clan.xp / GAME_CONFIG.XP_PER_LEVEL) + 1;
        
        if (newLevel > clan.level) {
            clan.level = newLevel;
            // Bonus de niveau: unités gratuites
            const levelDiff = newLevel - oldLevel;
            clan.units.w += levelDiff * 2;
            clan.units.a += levelDiff;
            clan.units.m += Math.floor(levelDiff / 2);
            clan.treasury += levelDiff * 50;
            return levelDiff;
        }
        return false;
    };
    
    // Logique de combat avancée
    const simulateBattle = (attacker, defender) => {
        const attackerPower = calculatePower(attacker);
        const defenderPower = calculatePower(defender);
        
        // Facteurs aléatoires et tactiques
        const attackerLuck = Math.random() * 0.2 + 0.9; // 0.9 à 1.1
        const defenderLuck = Math.random() * 0.2 + 0.9;
        const defenderBonus = 1.05; // 5% d'avantage défensif
        
        const finalAttackerPower = attackerPower * attackerLuck;
        const finalDefenderPower = defenderPower * defenderLuck * defenderBonus;
        
        const powerDiff = Math.abs(finalAttackerPower - finalDefenderPower);
        const totalPower = finalAttackerPower + finalDefenderPower;
        const diffPercentage = (powerDiff / totalPower) * 100;
        
        let result;
        if (diffPercentage < 5) {
            result = 'draw';
        } else if (finalAttackerPower > finalDefenderPower) {
            result = 'victory';
        } else {
            result = 'defeat';
        }
        
        return {
            result,
            attackerPower: Math.round(finalAttackerPower),
            defenderPower: Math.round(finalDefenderPower),
            powerDiff: Math.round(powerDiff),
            diffPercentage: Math.round(diffPercentage * 10) / 10
        };
    };
    
    // Calcul des pertes avec vérifications
    const calculateLosses = (clan, severity = 'medium') => {
        const multipliers = {
            light: { min: 0.05, max: 0.1 },
            medium: { min: 0.1, max: 0.2 },
            heavy: { min: 0.15, max: 0.3 }
        };
        
        const mult = multipliers[severity];
        const lossRate = Math.random() * (mult.max - mult.min) + mult.min;
        
        const losses = {
            w: Math.max(0, Math.floor(clan.units.w * lossRate)),
            a: Math.max(0, Math.floor(clan.units.a * lossRate)),
            m: Math.max(0, Math.floor(clan.units.m * lossRate))
        };
        
        // Appliquer les pertes avec vérifications
        clan.units.w = Math.max(0, clan.units.w - losses.w);
        clan.units.a = Math.max(0, clan.units.a - losses.a);
        clan.units.m = Math.max(0, clan.units.m - losses.m);
        
        return losses.w + losses.a + losses.m;
    };
    
    const save = async () => {
        try {
            ctx.clanData = data;
            await saveDataImmediate();
        } catch (error) {
            ctx.log.error("❌ Erreur sauvegarde clans:", error);
            throw new Error("Erreur de sauvegarde");
        }
    };
    
    // Validation des données
    const validateClanData = (clan) => {
        if (!clan) return false;
        
        // Vérifications de base
        if (!clan.id || !clan.name || !clan.leader || !Array.isArray(clan.members)) {
            return false;
        }
        
        // Vérifications numériques
        clan.level = Math.max(1, clan.level || 1);
        clan.xp = Math.max(0, clan.xp || 0);
        clan.treasury = Math.max(0, clan.treasury || 0);
        
        // Vérifications unités
        if (!clan.units) clan.units = { w: 0, a: 0, m: 0 };
        clan.units.w = Math.max(0, clan.units.w || 0);
        clan.units.a = Math.max(0, clan.units.a || 0);
        clan.units.m = Math.max(0, clan.units.m || 0);
        
        // Vérifications membres
        clan.members = clan.members.filter((m, i, arr) => arr.indexOf(m) === i); // Supprimer doublons
        if (clan.members.length > GAME_CONFIG.MAX_MEMBERS) {
            clan.members = clan.members.slice(0, GAME_CONFIG.MAX_MEMBERS);
        }
        
        // Vérifier que le leader est dans les membres
        if (!clan.members.includes(clan.leader)) {
            clan.members.unshift(clan.leader);
        }
        
        return true;
    };
    
    // Notification améliorée
    const notifyBattle = async (defenderId, attackerName, defenderName, battleResult) => {
        const resultEmojis = {
            victory: '💀 DÉFAITE',
            defeat: '🏆 VICTOIRE',
            draw: '🤝 MATCH NUL'
        };
        
        const msg = `⚔️ **BATAILLE TERMINÉE !**\n🏰 ${attackerName} a attaqué ${defenderName}\n${resultEmojis[battleResult.result]} pour toi !\n📊 Puissance: ${battleResult.defenderPower} vs ${battleResult.attackerPower}`;
        
        try {
            await sendMessage(defenderId, msg);
        } catch (err) {
            ctx.log.debug(`❌ Notification bataille non envoyée à ${defenderId}`);
        }
    };
    
    // === COMMANDES ===
    
    switch (action) {
        case 'create':
            const newClanName = args_parts.slice(1).join(' ').trim();
            if (!newClanName) {
                return "⚔️ **CRÉER UN CLAN**\n\nUsage: `/clan create [nom]`\nExemple: `/clan create Dragons Noirs` 🐉\n\n📋 **Règles:**\n• Nom unique (2-30 caractères)\n• Pas de caractères spéciaux\n• Un seul clan par personne";
            }
            
            if (newClanName.length < 2 || newClanName.length > 30) {
                return "❌ Le nom doit faire entre 2 et 30 caractères !";
            }
            
            if (getUserClan()) return "❌ Tu as déjà un clan ! Utilise `/clan leave` d'abord.";
            
            if (!canCreateClan()) {
                const timeLeft = formatTime(getCooldownTime());
                return `❌ Tu as supprimé un clan récemment !\n⏰ Attends encore **${timeLeft}** pour en créer un nouveau.`;
            }
            
            if (findClan(newClanName)) return `❌ Le nom "${newClanName}" existe déjà ! Choisis autre chose.`;
            
            const clanId = generateId('clan');
            const newClan = {
                id: clanId,
                name: newClanName,
                leader: userId,
                members: [userId],
                level: 1,
                xp: 0,
                treasury: 100,
                units: { w: 10, a: 5, m: 2 },
                lastDefeat: null,
                lastBattles: {},
                created: Date.now()
            };
            
            if (!validateClanData(newClan)) {
                return "❌ Erreur lors de la création du clan !";
            }
            
            data.clans[clanId] = newClan;
            data.userClans[userId] = clanId;
            await save();
            
            ctx.log.info(`🏰 Nouveau clan créé: ${newClanName} (${clanId}) par ${userId}`);
            return `🎉 **CLAN CRÉÉ AVEC SUCCÈS !**\n\n🏰 **"${newClanName}"** (ID: **${clanId}**)\n👑 Chef: Toi\n📊 Puissance: ${calculatePower(newClan)} pts\n\n💰 **Ressources de départ:**\n• 100 pièces d'or\n• 10 guerriers 🗡️\n• 5 archers 🏹\n• 2 mages 🔮\n\n⭐ Niveau 1 • 0/1000 XP\n\n💡 **Prochaines étapes:**\n• Invite des amis: \`/clan invite @ami\`\n• Consulte ton clan: \`/clan info\`\n• Lance des batailles: \`/clan battle [cible]\``;

        case 'info':
            const clan = getUserClan();
            if (!clan) {
                addToMemory(userId, 'user', `/clan ${args}`);
                const response = "❌ Tu n'as pas de clan !\n\n🏰 Crée ton clan: `/clan create [nom]`\n📜 Voir tous les clans: `/clan list`\n❓ Guide complet: `/clan help`";
                addToMemory(userId, 'assistant', response);
                return response;
            }
            
            if (!validateClanData(clan)) {
                return "❌ Données du clan corrompues ! Contacte un administrateur.";
            }
            
            const nextXP = (clan.level * GAME_CONFIG.XP_PER_LEVEL) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ **PROTÉGÉ** ' : '';
            const totalPower = calculatePower(clan);
            const xpProgress = Math.floor((clan.xp % GAME_CONFIG.XP_PER_LEVEL) / GAME_CONFIG.XP_PER_LEVEL * 100);
            
            // Calcul des bonus détaillés
            const levelBonus = clan.level * 100 + Math.pow(clan.level, 1.2) * 10;
            const memberBonus = clan.members.length * 30;
            const unitPower = clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15;
            
            addToMemory(userId, 'user', `/clan ${args}`);
            const infoResponse = `🏰 **${clan.name}** (ID: ${clan.id}) ${protection}\n\n📊 **PUISSANCE TOTALE: ${totalPower} POINTS**\n⭐ Niveau ${clan.level} (+${Math.floor(levelBonus)} pts)\n👥 ${clan.members.length}/${GAME_CONFIG.MAX_MEMBERS} membres (+${memberBonus} pts)\n💰 ${clan.treasury} pièces d'or\n\n✨ **Progression:** ${clan.xp} XP (${nextXP} pour niveau ${clan.level + 1})\n▓${'█'.repeat(Math.floor(xpProgress/10))}${'░'.repeat(10-Math.floor(xpProgress/10))} ${xpProgress}%\n\n⚔️ **ARMÉE** (+${unitPower} pts):\n🗡️ **${clan.units.w} Guerriers** (+${clan.units.w * 10} pts)\n🏹 **${clan.units.a} Archers** (+${clan.units.a * 8} pts)\n🔮 **${clan.units.m} Mages** (+${clan.units.m * 15} pts)\n\n${clan.members.length >= 10 ? `💫 **BONUS SYNERGIE:** +${clan.members.length * 5} pts\n` : ''}📈 **Analyse tactique:**\n• Efficacité: ${Math.floor(unitPower / Math.max(1, clan.units.w + clan.units.a + clan.units.m) * 10) / 10}/unité\n• Diversité: ${[clan.units.w > 0, clan.units.a > 0, clan.units.m > 0].filter(Boolean).length}/3 types (+${[clan.units.w > 0, clan.units.a > 0, clan.units.m > 0].filter(Boolean).length * 20} pts)\n\n💡 Tape \`/clan strategy\` pour les conseils avancés !`;
            addToMemory(userId, 'assistant', infoResponse);
            return infoResponse;

        case 'strategy':
            const strategyClan = getUserClan();
            if (!strategyClan) return "❌ Tu n'as pas de clan ! Crée-en un d'abord.";
            
            const power = calculatePower(strategyClan);
            const avgPower = Object.values(data.clans).reduce((sum, c) => sum + calculatePower(c), 0) / Object.keys(data.clans).length;
            
            let strategyText = `🧠 **STRATÉGIES AVANCÉES POUR ${strategyClan.name}**\n\n`;
            
            // Analyse de force
            if (power > avgPower * 1.2) {
                strategyText += `💪 **STATUT: DOMINANT** (${Math.floor(power/avgPower*100)}% de la moyenne)\n🎯 Attaque les clans moyens pour XP facile\n🛡️ Les autres clans t'éviteront\n`;
            } else if (power < avgPower * 0.8) {
                strategyText += `📈 **STATUT: EN DÉVELOPPEMENT** (${Math.floor(power/avgPower*100)}% de la moyenne)\n🎯 Concentre-toi sur le recrutement\n💰 Économise pour des mages\n⚠️ Évite les gros clans\n`;
            } else {
                strategyText += `⚖️ **STATUT: ÉQUILIBRÉ** (${Math.floor(power/avgPower*100)}% de la moyenne)\n🎯 Cherche des cibles similaires\n📊 Diversifie ton armée\n`;
            }
            
            strategyText += `\n🏆 **OPTIMISATIONS RECOMMANDÉES:**\n`;
            
            // Conseils spécifiques
            if (strategyClan.members.length < 5) {
                strategyText += `👥 **PRIORITÉ: Recrutement** (+${(10-strategyClan.members.length)*30} pts potentiels)\n`;
            }
            
            if (strategyClan.units.m < strategyClan.units.w / 3) {
                strategyText += `🔮 **Plus de mages** (meilleur ratio puissance/coût)\n`;
            }
            
            if (strategyClan.treasury > 200) {
                strategyText += `💰 **Dépense ton or** (${strategyClan.treasury} pièces en trop)\n`;
            }
            
            const unitTypes = [strategyClan.units.w > 0, strategyClan.units.a > 0, strategyClan.units.m > 0].filter(Boolean).length;
            if (unitTypes < 3) {
                strategyText += `🎨 **Diversifie ton armée** (+${(3-unitTypes)*20} pts bonus)\n`;
            }
            
            strategyText += `\n📊 **CALCULS DÉTAILLÉS:**\n`;
            strategyText += `• Niveau: ${strategyClan.level * 100 + Math.floor(Math.pow(strategyClan.level, 1.2) * 10)} pts\n`;
            strategyText += `• Membres: ${strategyClan.members.length * 30} pts\n`;
            strategyText += `• Unités: ${strategyClan.units.w * 10 + strategyClan.units.a * 8 + strategyClan.units.m * 15} pts\n`;
            strategyText += `• XP: ${Math.floor(strategyClan.xp / 100) * 5} pts\n`;
            strategyText += `• Diversité: ${unitTypes * 20} pts\n`;
            if (strategyClan.members.length >= 10) {
                strategyText += `• Synergie: ${strategyClan.members.length * 5} pts\n`;
            }
            
            strategyText += `\n💡 **CONSEILS ÉCONOMIQUES:**\n`;
            strategyText += `• Mage = 80💰 pour +15 pts (5.3 pts/💰)\n`;
            strategyText += `• Guerrier = 40💰 pour +10 pts (4 pts/💰)\n`;
            strategyText += `• Archer = 60💰 pour +8 pts (3.75 pts/💰)\n`;
            strategyText += `• **Conclusion:** Privilégie les MAGES ! 🔮`;
            
            return strategyText;

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ Tu n'as pas de clan !";
            if (!validateClanData(attackerClan)) return "❌ Données du clan invalides !";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) return "⚔️ **LANCER UNE BATAILLE**\n\nUsage: `/clan battle [id ou nom]`\nExemples:\n• `/clan battle A7B2`\n• `/clan battle Dragons`\n\n💡 Voir les cibles: `/clan list`";
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return `❌ Clan "${enemyArg}" introuvable !\n💡 Vérifie avec \`/clan list\``;
            if (!validateClanData(enemyClan)) return "❌ Données du clan ennemi invalides !";
            
            if (enemyClan.id === attackerClan.id) return "❌ Tu ne peux pas t'attaquer toi-même !";
            
            // Vérifications de protection et cooldown
            if (isProtected(enemyClan)) {
                const protectionLeft = formatTime(GAME_CONFIG.PROTECTION_TIME - (Date.now() - enemyClan.lastDefeat));
                return `🛡️ **${enemyClan.name} est protégé !**\n⏰ Protection restante: ${protectionLeft}`;
            }
            
            if (!canBattleAgainst(attackerClan, enemyClan)) {
                const nextBattle = formatTime(getNextBattleTime(attackerClan, enemyClan));
                return `⏳ **Cooldown actif !**\nTu as déjà combattu ${enemyClan.name} récemment.\n⏰ Prochain combat possible dans: ${nextBattle}\n\n💡 Tu peux attaquer d'autres clans en attendant !`;
            }
            
            // Vérification des unités minimales
            const attackerUnits = attackerClan.units.w + attackerClan.units.a + attackerClan.units.m;
            const defenderUnits = enemyClan.units.w + enemyClan.units.a + enemyClan.units.m;
            
            if (attackerUnits === 0) return "❌ Tu n'as plus d'unités ! Achète des renforts avec `/clan units`";
            if (defenderUnits === 0) return "❌ Le clan ennemi n'a plus d'unités ! Trouve une autre cible.";
            
            // Simulation de bataille
            const battleResult = simulateBattle(attackerClan, enemyClan);
            
            // Application des résultats avec vérifications
            const rewards = GAME_CONFIG.BATTLE_REWARDS[battleResult.result];
            
            // XP et niveaux
            const attackerLevelUp = addXP(attackerClan, rewards.xp);
            const defenderXP = battleResult.result === 'victory' ? 50 : battleResult.result === 'defeat' ? 150 : 100;
            const defenderLevelUp = addXP(enemyClan, defenderXP);
            
            // Or avec vérifications
            attackerClan.treasury = Math.max(0, attackerClan.treasury + rewards.gold);
            const enemyGoldChange = battleResult.result === 'victory' ? -75 : battleResult.result === 'defeat' ? 75 : 0;
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGoldChange);
            
            // Pertes d'unités
            let attackerLosses = 0;
            let defenderLosses = 0;
            
            if (battleResult.result === 'victory') {
                attackerLosses = calculateLosses(attackerClan, 'light');
                defenderLosses = calculateLosses(enemyClan, 'heavy');
                enemyClan.lastDefeat = Date.now();
            } else if (battleResult.result === 'defeat') {
                attackerLosses = calculateLosses(attackerClan, 'heavy');
                defenderLosses = calculateLosses(enemyClan, 'light');
                attackerClan.lastDefeat = Date.now();
            } else {
                attackerLosses = calculateLosses(attackerClan, 'medium');
                defenderLosses = calculateLosses(enemyClan, 'medium');
            }
            
            // Mise à jour des cooldowns
            if (!attackerClan.lastBattles) attackerClan.lastBattles = {};
            if (!enemyClan.lastBattles) enemyClan.lastBattles = {};
            attackerClan.lastBattles[enemyClan.id] = Date.now();
            enemyClan.lastBattles[attackerClan.id] = Date.now();
            
            // Sauvegarde des statistiques de bataille
            const battleId = generateId('battle');
            data.battles[battleId] = {
                id: battleId,
                timestamp: Date.now(),
                attacker: { id: attackerClan.id, name: attackerClan.name, power: battleResult.attackerPower },
                defender: { id: enemyClan.id, name: enemyClan.name, power: battleResult.defenderPower },
                result: battleResult.result,
                losses: { attacker: attackerLosses, defender: defenderLosses }
            };
            
            // Validation finale des données
            validateClanData(attackerClan);
            validateClanData(enemyClan);
            
            await save();
            
            // Notification au défenseur
            if (enemyClan.leader !== userId) {
                await notifyBattle(enemyClan.leader, attackerClan.name, enemyClan.name, battleResult);
            }
            
            // Résultat de bataille détaillé
            let battleResponse = `⚔️ **BATAILLE: ${attackerClan.name} VS ${enemyClan.name}**\n\n`;
            battleResponse += `📊 **ANALYSE TACTIQUE:**\n`;
            battleResponse += `🔥 Puissance d'attaque: ${battleResult.attackerPower} pts\n`;
            battleResponse += `🛡️ Puissance de défense: ${battleResult.defenderPower} pts\n`;
            battleResponse += `📈 Écart: ${battleResult.powerDiff} pts (${battleResult.diffPercentage}%)\n\n`;
            
            const resultEmojis = {
                victory: '🏆 **VICTOIRE ÉCLATANTE !**',
                defeat: '💀 **DÉFAITE CUISANTE...**',
                draw: '🤝 **MATCH NUL HÉROÏQUE !**'
            };
            
            battleResponse += `${resultEmojis[battleResult.result]}\n\n`;
            
            // Détails des gains/pertes
            battleResponse += `📋 **RÉSULTATS POUR ${attackerClan.name}:**\n`;
            battleResponse += `✨ XP: +${rewards.xp} (${attackerClan.xp}/${attackerClan.level * GAME_CONFIG.XP_PER_LEVEL})\n`;
            battleResponse += `💰 Or: ${rewards.gold >= 0 ? '+' : ''}${rewards.gold} (Total: ${attackerClan.treasury})\n`;
            battleResponse += `💀 Pertes: ${attackerLosses} unités\n`;
            
            if (attackerLevelUp) {
                battleResponse += `\n🆙 **NIVEAU UP !** Niveau ${attackerClan.level}\n`;
                battleResponse += `🎁 Bonus: +${attackerLevelUp * 2} guerriers, +${attackerLevelUp} archers, +${Math.floor(attackerLevelUp/2)} mages, +${attackerLevelUp * 50}💰\n`;
            }
            
            // Cooldown info
            battleResponse += `\n⏳ **Cooldown:** 1h avant de réattaquer ${enemyClan.name}\n`;
            
            if (battleResult.result === 'defeat') {
                const protectionTime = formatTime(GAME_CONFIG.PROTECTION_TIME);
                battleResponse += `🛡️ **Protection:** ${protectionTime} contre toute attaque\n`;
            }
            
            battleResponse += `\n💡 **Conseil:** `;
            if (battleResult.result === 'victory') {
                battleResponse += `Excellent ! Cherche maintenant des cibles plus fortes pour plus d'XP.`;
            } else if (battleResult.result === 'defeat') {
                battleResponse += `Renforce ton armée et recrute des membres avant la prochaine bataille.`;
            } else {
                battleResponse += `Match serré ! Un léger avantage aurait fait la différence.`;
            }
            
            ctx.log.info(`⚔️ Bataille: ${attackerClan.name} (${battleResult.attackerPower}) VS ${enemyClan.name} (${battleResult.defenderPower}) - ${battleResult.result}`);
            return battleResponse;

        case 'list':
            const topClans = Object.values(data.clans)
                .filter(validateClanData)
                .sort((a, b) => {
                    const powerA = calculatePower(a);
                    const powerB = calculatePower(b);
                    if (powerB !== powerA) return powerB - powerA;
                    return b.level - a.level || b.xp - a.xp;
                })
                .slice(0, 15);
            
            if (topClans.length === 0) return "❌ Aucun clan ! Crée le premier avec `/clan create [nom]`";
            
            let list = `🏆 **CLASSEMENT DES CLANS** (Top ${Math.min(15, topClans.length)})\n\n`;
            
            const userClan = getUserClan();
            const totalClans = Object.keys(data.clans).length;
            
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '';
                const isUserClan = userClan && clan.id === userClan.id ? '👑' : '';
                const totalPower = calculatePower(clan);
                
                // Indicateur de force
                let strengthIndicator = '';
                if (totalPower > 1000) strengthIndicator = '🔥';
                else if (totalPower > 500) strengthIndicator = '⚡';
                else if (totalPower > 250) strengthIndicator = '📈';
                
                list += `${medal} **${clan.name}** (${clan.id}) ${protection}${isUserClan}${strengthIndicator}\n`;
                list += `   📊 ${totalPower} pts • ⭐ Niv.${clan.level} • 👥 ${clan.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n`;
                list += `   💰 ${clan.treasury} • ⚔️ ${clan.units.w}g/${clan.units.a}a/${clan.units.m}m\n`;
                
                // Analyse tactique rapide
                if (userClan && clan.id !== userClan.id) {
                    const userPower = calculatePower(userClan);
                    const diff = ((totalPower - userPower) / userPower * 100);
                    
                    if (Math.abs(diff) < 10) {
                        list += `   🎯 **Cible idéale** (écart: ${Math.round(Math.abs(diff))}%)\n`;
                    } else if (diff > 50) {
                        list += `   ⚠️ **Très dangereux** (+${Math.round(diff)}%)\n`;
                    } else if (diff < -30) {
                        list += `   💚 **Cible facile** (${Math.round(diff)}%)\n`;
                    }
                }
                list += '\n';
            });
            
            // Statistiques globales
            list += `📊 **STATISTIQUES GLOBALES:**\n`;
            list += `• ${totalClans} clans actifs\n`;
            list += `• Puissance moyenne: ${Math.round(topClans.reduce((sum, c) => sum + calculatePower(c), 0) / topClans.length)} pts\n`;
            list += `• ${topClans.filter(c => isProtected(c)).length} clans protégés 🛡️\n\n`;
            
            if (userClan) {
                const userRank = topClans.findIndex(c => c.id === userClan.id) + 1;
                if (userRank > 0) {
                    list += `👑 **Ton rang:** #${userRank}/${totalClans}\n`;
                } else {
                    list += `👑 **Ton clan:** Hors top 15\n`;
                }
            }
            
            list += `\n💡 **Légendes:**\n🛡️ Protégé • 👑 Ton clan • 🔥 Elite (1000+ pts)\n⚡ Fort (500+ pts) • 📈 Montant (250+ pts)`;
            
            return list;

        case 'invite':
            if (!isLeader()) return "❌ Seul le chef peut inviter des membres !";
            
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) {
                return "👥 **INVITER UN MEMBRE**\n\nUsage: `/clan invite @utilisateur`\nExemple: `/clan invite @JohnDoe`\n\n💡 **Avantages des membres:**\n• +30 points de puissance par membre\n• Bonus de synergie à 10+ membres\n• Maximum: 20 membres";
            }
            
            const inviterClan = getUserClan();
            if (!validateClanData(inviterClan)) return "❌ Données du clan invalides !";
            
            if (inviterClan.members.length >= GAME_CONFIG.MAX_MEMBERS) {
                return `❌ Clan plein ! (${GAME_CONFIG.MAX_MEMBERS} membres maximum)\n💡 Promeus quelqu'un d'autre en chef et quitte pour faire de la place.`;
            }
            
            if (data.userClans[targetUser]) {
                const existingClan = data.clans[data.userClans[targetUser]];
                return `❌ Cette personne est déjà dans le clan "${existingClan?.name || 'Inconnu'}" !`;
            }
            
            // Initialiser les invitations si nécessaire
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            
            if (data.invites[targetUser].includes(inviterClan.id)) {
                return `❌ Tu as déjà invité cette personne !\nElle peut rejoindre avec: \`/clan join ${inviterClan.id}\``;
            }
            
            // Limitation des invitations (max 3 invitations par clan)
            if (data.invites[targetUser].length >= 3) {
                return "❌ Cette personne a déjà 3 invitations en attente ! Elle doit d'abord en traiter.";
            }
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            
            ctx.log.info(`📨 Invitation envoyée: ${targetUser} vers ${inviterClan.name} (${inviterClan.id})`);
            return `📨 **INVITATION ENVOYÉE !**\n\n👤 ${args_parts[1]} a été invité dans **${inviterClan.name}**\n🆔 Il peut rejoindre avec: \`/clan join ${inviterClan.id}\`\n\n📊 **Après son arrivée:**\n• Puissance: +30 points\n• Membres: ${inviterClan.members.length + 1}/${GAME_CONFIG.MAX_MEMBERS}\n${inviterClan.members.length + 1 >= 10 ? '• 🎉 Bonus synergie débloqué !\n' : ''}`;

        case 'join':
            const joinArg = args_parts[1];
            
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) {
                    return "📬 **AUCUNE INVITATION**\n\nTu n'as reçu aucune invitation de clan.\n\n🏰 **Options:**\n• Crée ton clan: `/clan create [nom]`\n• Demande une invitation à un ami\n• Consulte les clans: `/clan list`";
                }
                
                let inviteList = `📬 **TES INVITATIONS** (${myInvites.length})\n\n`;
                
                myInvites.forEach((clanId, i) => {
                    const c = data.clans[clanId];
                    if (c && validateClanData(c)) {
                        const power = calculatePower(c);
                        const protection = isProtected(c) ? '🛡️' : '';
                        inviteList += `${i+1}. **${c.name}** (${clanId}) ${protection}\n`;
                        inviteList += `   📊 ${power} pts • ⭐ Niv.${c.level} • 👥 ${c.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n`;
                        inviteList += `   💰 ${c.treasury} • ⚔️ ${c.units.w}g/${c.units.a}a/${c.units.m}m\n\n`;
                    }
                });
                
                inviteList += `🎯 **Pour rejoindre:**\n\`/clan join [id]\` (ex: \`/clan join ${myInvites[0]}\`)`;
                return inviteList;
            }
            
            if (getUserClan()) return "❌ Tu es déjà dans un clan !\nUtilise `/clan leave` d'abord si tu veux changer.";
            
            const joinClan = findClan(joinArg);
            if (!joinClan) return `❌ Clan "${joinArg}" introuvable !\n💡 Vérifie l'ID avec \`/clan join\` (sans arguments)`;
            
            if (!validateClanData(joinClan)) return "❌ Données du clan invalides !";
            
            if (!data.invites[userId]?.includes(joinClan.id)) {
                return `❌ Tu n'es pas invité dans **${joinClan.name}** !\n💡 Demande une invitation au chef du clan.`;
            }
            
            if (joinClan.members.length >= GAME_CONFIG.MAX_MEMBERS) {
                return `❌ **${joinClan.name}** est complet ! (${GAME_CONFIG.MAX_MEMBERS}/${GAME_CONFIG.MAX_MEMBERS})\n💡 Demande au chef de faire de la place.`;
            }
            
            // Rejoindre le clan
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            
            // Nettoyer les invitations
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            if (data.invites[userId].length === 0) {
                delete data.invites[userId];
            }
            
            validateClanData(joinClan);
            await save();
            
            ctx.log.info(`🏰 ${userId} a rejoint le clan: ${joinClan.name} (${joinClan.id})`);
            
            const newPower = calculatePower(joinClan);
            return `🎉 **BIENVENUE DANS ${joinClan.name.toUpperCase()} !**\n\n🏰 **Informations du clan:**\n🆔 ID: ${joinClan.id}\n👑 Chef: <@${joinClan.leader}>\n📊 Puissance: ${newPower} pts (+30 grâce à toi !)\n⭐ Niveau ${joinClan.level} • 👥 ${joinClan.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n\n💡 **Prochaines étapes:**\n• Consulte les stats: \`/clan info\`\n• Participe aux batailles: \`/clan battle [cible]\`\n• Apprends les stratégies: \`/clan strategy\`\n\n${joinClan.members.length >= 10 ? '🎊 **BONUS SYNERGIE ACTIF !** (+' + (joinClan.members.length * 5) + ' pts)\n' : ''}Bon combat, guerrier ! ⚔️`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ Tu n'es pas dans un clan !";
            
            if (!validateClanData(leaveClan)) return "❌ Données du clan invalides !";
            
            // Le chef ne peut pas partir si il y a d'autres membres
            if (isLeader() && leaveClan.members.length > 1) {
                const otherMembers = leaveClan.members.filter(id => id !== userId);
                let memberList = "👥 **MEMBRES DISPONIBLES:**\n";
                otherMembers.slice(0, 5).forEach((memberId, i) => {
                    memberList += `${i+1}. <@${memberId}>\n`;
                });
                
                return `❌ **TU ES LE CHEF !**\n\nTu ne peux pas partir tant qu'il y a d'autres membres.\n\n🔄 **Options:**\n• Promeus un nouveau chef: \`/clan promote @membre\`\n• Attendre que tous partent (dissolution auto)\n\n${memberList}\n💡 Utilise: \`/clan promote @membre\``;
            }
            
            const leaveClanName = leaveClan.name;
            const wasLeader = isLeader();
            
            if (wasLeader) {
                // Dissolution complète du clan
                const memberCount = leaveClan.members.length;
                leaveClan.members.forEach(memberId => {
                    delete data.userClans[memberId];
                });
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                
                await save();
                
                ctx.log.info(`🏰 Clan dissous: ${leaveClanName} par ${userId} (${memberCount} membres)`);
                
                const cooldownTime = formatTime(GAME_CONFIG.CREATION_COOLDOWN);
                return `💥 **CLAN "${leaveClanName.toUpperCase()}" DISSOUS !**\n\n⚰️ Le clan et toutes ses ressources ont été perdus\n👥 ${memberCount} membre(s) libéré(s)\n\n⏰ **Cooldown de création:** ${cooldownTime}\nTu pourras créer un nouveau clan dans 3 jours.\n\n💡 **Conseil:** La prochaine fois, transfère le leadership avant de partir !`;
            } else {
                // Simple départ
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                
                validateClanData(leaveClan);
                await save();
                
                ctx.log.info(`👋 ${userId} a quitté le clan: ${leaveClanName}`);
                
                const newPower = calculatePower(leaveClan);
                return `👋 **TU AS QUITTÉ "${leaveClanName.toUpperCase()}"**\n\n📉 Puissance du clan: ${newPower} pts (-30)\n👥 Membres restants: ${leaveClan.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n\n🏰 **Tu peux maintenant:**\n• Créer ton propre clan: \`/clan create [nom]\`\n• Rejoindre un autre clan: \`/clan list\`\n• Attendre d'autres invitations\n\nBonne chance dans tes futures aventures ! ⚔️`;
            }

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ Tu n'as pas de clan !";
            if (!validateClanData(unitsClan)) return "❌ Données du clan invalides !";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            
            if (!unitType) {
                const totalUnits = unitsClan.units.w + unitsClan.units.a + unitsClan.units.m;
                const totalUnitPower = unitsClan.units.w * 10 + unitsClan.units.a * 8 + unitsClan.units.m * 15;
                const avgEfficiency = totalUnits > 0 ? (totalUnitPower / totalUnits).toFixed(1) : 0;
                
                return `⚔️ **ARMÉE DE ${unitsClan.name.toUpperCase()}**\n\n📊 **UNITÉS ACTUELLES:**\n🗡️ **${unitsClan.units.w} Guerriers** (+${unitsClan.units.w * 10} pts)\n   💰 Coût: 40 | Efficacité: 4.0 pts/💰\n🏹 **${unitsClan.units.a} Archers** (+${unitsClan.units.a * 8} pts)\n   💰 Coût: 60 | Efficacité: 3.75 pts/💰\n🔮 **${unitsClan.units.m} Mages** (+${unitsClan.units.m * 15} pts) ⭐\n   💰 Coût: 80 | Efficacité: 5.3 pts/💰\n\n📈 **STATISTIQUES:**\n• Total unités: ${totalUnits}\n• Puissance unités: ${totalUnitPower} pts\n• Efficacité moyenne: ${avgEfficiency} pts/unité\n• Trésorerie: **${unitsClan.treasury} pièces** 💰\n\n🛒 **ACHETER DES UNITÉS:**\n\`/clan units guerrier [nombre]\` - Tanky et bon marché\n\`/clan units archer [nombre]\` - Équilibré\n\`/clan units mage [nombre]\` - Le plus efficace ! 🌟\n\n💡 **CONSEIL STRATÉGIQUE:**\nLes mages ont le meilleur rapport puissance/prix !\n${unitsClan.treasury >= 80 ? 'Tu peux acheter des mages maintenant !' : `Il te faut ${80 - unitsClan.treasury} pièces de plus pour un mage.`}`;
            }
            
            if (!isLeader()) {
                return `❌ **ACCÈS REFUSÉ**\n\nSeul le chef peut acheter des unités !\n👑 Chef actuel: <@${unitsClan.leader}>\n\n💡 Si tu veux gérer l'armée, demande au chef de te promouvoir avec \`/clan promote @toi\``;
            }
            
            if (quantity <= 0 || quantity > 100) {
                return "❌ Quantité invalide ! (1-100 unités maximum par achat)";
            }
            
            let cost = 0, unitKey = '', unitName = '', unitEmoji = '';
            
            if (['guerrier', 'g', 'warrior', 'w'].includes(unitType)) {
                cost = GAME_CONFIG.UNIT_COSTS.w * quantity;
                unitKey = 'w';
                unitName = quantity === 1 ? 'guerrier' : 'guerriers';
                unitEmoji = '🗡️';
            } else if (['archer', 'a'].includes(unitType)) {
                cost = GAME_CONFIG.UNIT_COSTS.a * quantity;
                unitKey = 'a';
                unitName = quantity === 1 ? 'archer' : 'archers';
                unitEmoji = '🏹';
            } else if (['mage', 'm'].includes(unitType)) {
                cost = GAME_CONFIG.UNIT_COSTS.m * quantity;
                unitKey = 'm';
                unitName = quantity === 1 ? 'mage' : 'mages';
                unitEmoji = '🔮';
            } else {
                return "❌ **TYPE D'UNITÉ INVALIDE**\n\nTypes disponibles:\n• `guerrier` ou `g` - 40💰 (+10 pts)\n• `archer` ou `a` - 60💰 (+8 pts)\n• `mage` ou `m` - 80💰 (+15 pts) ⭐\n\nExemple: `/clan units mage 3`";
            }
            
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ **FONDS INSUFFISANTS**\n\n💰 Coût: **${cost} pièces**\n💰 Disponible: **${unitsClan.treasury} pièces**\n💰 Manquant: **${missing} pièces**\n\n💡 **Comment gagner de l'or:**\n• Gagne des batailles (+100💰)\n• Monte de niveau (+50💰/niveau)\n• Attends les bonus quotidiens (bientôt !)`;
            }
            
            // Achat des unités
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            
            const powerGain = quantity * GAME_CONFIG.UNIT_POWER[unitKey];
            const newPower = calculatePower(unitsClan);
            
            validateClanData(unitsClan);
            await save();
            
            ctx.log.info(`🛒 Achat: ${quantity} ${unitName} par ${unitsClan.name} (${cost}💰)`);
            
            return `✅ **ACHAT RÉUSSI !**\n\n${unitEmoji} **${quantity} ${unitName}** recruté(s) pour **${cost}💰**\n\n📊 **NOUVEAUX TOTAUX:**\n• ${unitEmoji} ${unitName.charAt(0).toUpperCase() + unitName.slice(1)}: ${unitsClan.units[unitKey]}\n• 💰 Trésorerie: ${unitsClan.treasury} pièces\n• 📈 Puissance: ${newPower} pts (+${powerGain})\n\n⚔️ **Armée totale:** ${unitsClan.units.w}🗡️ ${unitsClan.units.a}🏹 ${unitsClan.units.m}🔮\n\n💡 Ton clan est maintenant plus fort ! Temps de conquérir ! 🏆`;

        case 'promote':
            if (!isLeader()) {
                const currentClan = getUserClan();
                return `❌ **ACCÈS REFUSÉ**\n\nSeul le chef peut promouvoir !\n👑 Chef actuel: <@${currentClan?.leader || 'Inconnu'}>\n\n💡 Seul le chef peut transférer son rôle à un autre membre.`;
            }
            
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) {
                const promoteClan = getUserClan();
                const otherMembers = promoteClan.members.filter(id => id !== userId);
                
                let memberList = "👥 **MEMBRES PROMOUVABLES:**\n\n";
                otherMembers.forEach((memberId, i) => {
                    memberList += `${i+1}. <@${memberId}>\n`;
                });
                
                return `👑 **PROMOUVOIR UN NOUVEAU CHEF**\n\nUsage: \`/clan promote @nouveau_chef\`\n\n${memberList}\n⚠️ **ATTENTION:**\n• Tu perdras le rôle de chef définitivement\n• Le nouveau chef aura tous les pouvoirs\n• Cette action est irréversible\n\n💡 Choisis quelqu'un de confiance !`;
            }
            
            const promoteClan = getUserClan();
            if (!validateClanData(promoteClan)) return "❌ Données du clan invalides !";
            
            if (newLeader === userId) {
                return "❌ Tu es déjà le chef ! 👑\n💡 Pour promouvoir quelqu'un d'autre, utilise son ID.";
            }
            
            if (!promoteClan.members.includes(newLeader)) {
                return `❌ **MEMBRE INTROUVABLE**\n\n<@${newLeader}> n'est pas membre de **${promoteClan.name}** !\n\n👥 **Membres actuels:** ${promoteClan.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n💡 Invite d'abord cette personne avec \`/clan invite @personne\``;
            }
            
            // Changement de chef
            const oldLeader = promoteClan.leader;
            promoteClan.leader = newLeader;
            
            validateClanData(promoteClan);
            await save();
            
            ctx.log.info(`👑 Nouveau chef: ${newLeader} pour le clan ${promoteClan.name} (${promoteClan.id}), ancien: ${oldLeader}`);
            
            return `👑 **PROMOTION RÉUSSIE !**\n\n🏰 **${promoteClan.name}** a un nouveau chef !\n\n👑 **Nouveau chef:** <@${newLeader}>\n👤 **Ancien chef:** <@${oldLeader}> (maintenant membre)\n\n🔄 **Pouvoirs transférés:**\n• Gestion des membres et invitations\n• Achat d'unités et gestion du trésor\n• Lancement des batailles\n• Promotion d'autres membres\n\n💡 <@${newLeader}>, tu peux maintenant utiliser toutes les commandes de chef !\n\nFélicitations pour ton nouveau rôle ! 🎉`;

        case 'history':
            const historyLimit = parseInt(args_parts[1]) || 10;
            if (historyLimit > 50) return "❌ Maximum 50 batailles affichables !";
            
            const userClanHistory = getUserClan();
            if (!userClanHistory) return "❌ Tu n'as pas de clan !";
            
            const clanBattles = Object.values(data.battles)
                .filter(battle => battle.attacker.id === userClanHistory.id || battle.defender.id === userClanHistory.id)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, historyLimit);
            
            if (clanBattles.length === 0) {
                return `📚 **HISTORIQUE DE ${userClanHistory.name.toUpperCase()}**\n\n❌ Aucune bataille enregistrée !\n\n🎯 **Commence ton aventure:**\n• Lance ta première bataille: \`/clan battle [cible]\`\n• Trouve des cibles: \`/clan list\`\n• Apprends les stratégies: \`/clan strategy\``;
            }
            
            let historyText = `📚 **HISTORIQUE DE ${userClanHistory.name.toUpperCase()}** (${clanBattles.length} dernières)\n\n`;
            
            let victories = 0, defeats = 0, draws = 0;
            
            clanBattles.forEach((battle, i) => {
                const isAttacker = battle.attacker.id === userClanHistory.id;
                const enemy = isAttacker ? battle.defender : battle.attacker;
                const ally = isAttacker ? battle.attacker : battle.defender;
                
                let resultIcon = '';
                let resultText = '';
                
                if (battle.result === 'victory') {
                    if (isAttacker) {
                        resultIcon = '🏆';
                        resultText = 'VICTOIRE';
                        victories++;
                    } else {
                        resultIcon = '💀';
                        resultText = 'DÉFAITE';
                        defeats++;
                    }
                } else if (battle.result === 'defeat') {
                    if (isAttacker) {
                        resultIcon = '💀';
                        resultText = 'DÉFAITE';
                        defeats++;
                    } else {
                        resultIcon = '🏆';
                        resultText = 'VICTOIRE';
                        victories++;
                    }
                } else {
                    resultIcon = '🤝';
                    resultText = 'MATCH NUL';
                    draws++;
                }
                
                const timeAgo = formatTime(Date.now() - battle.timestamp);
                const role = isAttacker ? 'Attaque sur' : 'Défense contre';
                
                historyText += `${i+1}. ${resultIcon} **${resultText}** - ${role} ${enemy.name}\n`;
                historyText += `   📊 ${ally.power} vs ${enemy.power} pts • ⏰ Il y a ${timeAgo}\n`;
                historyText += `   💀 Pertes: ${isAttacker ? battle.losses.attacker : battle.losses.defender} unités\n\n`;
            });
            
            // Statistiques globales
            const totalBattles = victories + defeats + draws;
            const winRate = totalBattles > 0 ? Math.round((victories / totalBattles) * 100) : 0;
            
            historyText += `📊 **STATISTIQUES GLOBALES:**\n`;
            historyText += `🏆 Victoires: ${victories} (${Math.round(victories/totalBattles*100) || 0}%)\n`;
            historyText += `💀 Défaites: ${defeats} (${Math.round(defeats/totalBattles*100) || 0}%)\n`;
            historyText += `🤝 Matchs nuls: ${draws} (${Math.round(draws/totalBattles*100) || 0}%)\n`;
            historyText += `📈 **Taux de victoire: ${winRate}%**\n\n`;
            
            // Évaluation de performance
            if (winRate >= 70) {
                historyText += `⭐ **ÉVALUATION: CONQUÉRANT** - Excellent travail !`;
            } else if (winRate >= 50) {
                historyText += `📈 **ÉVALUATION: GUERRIER** - Performance solide !`;
            } else if (winRate >= 30) {
                historyText += `🔄 **ÉVALUATION: APPRENTI** - Continue tes efforts !`;
            } else {
                historyText += `💪 **ÉVALUATION: DÉBUTANT** - Entraîne-toi plus !`;
            }
            
            return historyText;

        case 'kick':
            if (!isLeader()) return "❌ Seul le chef peut exclure des membres !";
            
            const targetKick = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetKick) {
                const kickClan = getUserClan();
                const members = kickClan.members.filter(id => id !== userId);
                
                if (members.length === 0) {
                    return "❌ Il n'y a que toi dans le clan !\n💡 Utilise `/clan invite @ami` pour recruter.";
                }
                
                let memberList = `👥 **MEMBRES EXCLUSIBLES DE ${kickClan.name.toUpperCase()}:**\n\n`;
                members.forEach((memberId, i) => {
                    memberList += `${i+1}. <@${memberId}>\n`;
                });
                
                return `${memberList}\n⚠️ **EXCLUSION D'UN MEMBRE**\nUsage: \`/clan kick @membre\`\n\n💡 **Attention:** Cette action est irréversible !\nLe membre devra être ré-invité pour revenir.`;
            }
            
            const kickClan = getUserClan();
            if (!validateClanData(kickClan)) return "❌ Données du clan invalides !";
            
            if (targetKick === userId) {
                return "❌ Tu ne peux pas t'exclure toi-même !\n💡 Utilise `/clan leave` pour quitter le clan.";
            }
            
            if (!kickClan.members.includes(targetKick)) {
                return `❌ <@${targetKick}> n'est pas membre de **${kickClan.name}** !\n💡 Vérifie la liste avec \`/clan kick\` (sans arguments).`;
            }
            
            // Exclusion du membre
            kickClan.members = kickClan.members.filter(id => id !== targetKick);
            delete data.userClans[targetKick];
            
            // Supprimer les invitations en attente de ce membre vers d'autres clans
            if (data.invites[targetKick]) {
                delete data.invites[targetKick];
            }
            
            validateClanData(kickClan);
            await save();
            
            ctx.log.info(`👢 Exclusion: ${targetKick} du clan ${kickClan.name} par ${userId}`);
            
            const newPower = calculatePower(kickClan);
            return `👢 **MEMBRE EXCLU !**\n\n❌ <@${targetKick}> a été exclu de **${kickClan.name}**\n\n📉 **Impact sur le clan:**\n• Puissance: ${newPower} pts (-30)\n• Membres: ${kickClan.members.length}/${GAME_CONFIG.MAX_MEMBERS}\n${kickClan.members.length < 10 && kickClan.members.length >= 9 ? '• ⚠️ Bonus synergie perdu !\n' : ''}\n💡 **Tu peux inviter quelqu'un d'autre:** \`/clan invite @nouveau\``;

        case 'help':
            return `⚔️ **GUIDE COMPLET DES CLANS** - Édition Avancée\n\n🏰 **DÉMARRAGE:**\n• \`/clan create [nom]\` - Créer ton clan (cooldown 3j après suppression)\n• \`/clan info\` - Stats détaillées avec calculs de puissance\n• \`/clan list\` - Top 15 des clans avec analyse tactique\n• \`/clan strategy\` - Conseils personnalisés pour ton clan\n\n👥 **GESTION D'ÉQUIPE:**\n• \`/clan invite @user\` - Inviter (max 3 invitations par personne)\n• \`/clan join [id]\` - Rejoindre avec ID court (ex: A3B7)\n• \`/clan leave\` - Quitter (dissolution si chef seul)\n• \`/clan promote @user\` - Transférer leadership (irréversible)\n• \`/clan kick @user\` - Exclure un membre (chef seulement)\n\n⚔️ **SYSTÈME DE COMBAT AVANCÉ:**\n• \`/clan battle [id/nom]\` - Attaquer (cooldown 1h entre mêmes clans)\n• \`/clan history [nombre]\` - Historique des batailles\n• Protection 1h après défaite\n• Facteurs aléatoires et bonus défensif (5%)\n\n🛒 **GESTION DES UNITÉS:**\n• \`/clan units\` - Voir armée et statistiques\n• \`/clan units guerrier [nb]\` - 40💰 (+10 pts, tanky)\n• \`/clan units archer [nb]\` - 60💰 (+8 pts, équilibré)\n• \`/clan units mage [nb]\` - 80💰 (+15 pts, efficace) ⭐\n\n📈 **CALCUL DE PUISSANCE DÉTAILLÉ:**\n• **Niveau:** 100 + niveau^1.2 × 10 pts\n• **Membres:** 30 pts/personne + synergie (10+ = +5 pts/membre)\n• **Unités:** Guerriers 10pts, Archers 8pts, Mages 15pts\n• **XP:** +5 pts par 100 XP accumulée\n• **Diversité:** +20 pts par type d'unité différent\n\n🏆 **RÉSULTATS DE COMBAT:**\n• **Victoire** (>5% écart): +200 XP, +100💰, protection ennemi\n• **Match nul** (≤5% écart): +100 XP, 0💰, pas de protection\n• **Défaite** (<-5% écart): +50 XP, -50💰, protection 1h\n\n💡 **STRATÉGIES AVANCÉES:**\n• **Efficacité unités:** Mages > Guerriers > Archers (pts/💰)\n• **Recrutement prioritaire:** 10+ membres = bonus synergie\n• **Timing optimal:** Attaque les clans non-protégés\n• **Diversification:** 3 types d'unités = +60 pts bonus\n• **Économie:** Équilibre entre unités et membres\n\n🎯 **CONSEILS TACTIQUES:**\n• Évite les combats à puissance égale (risque de nul)\n• Attaque +10% plus faible pour victoire assurée\n• Développe d'abord les mages (meilleur ROI)\n• Recrute avant d'investir massivement en unités\n• Utilise le cooldown pour attaquer d'autres clans\n\n⚠️ **LIMITATIONS IMPORTANTES:**\n• Cooldown 1h entre batailles contre même clan\n• Max 20 membres par clan\n• Max 3 invitations en attente par personne\n• Créer clan: cooldown 3j après dissolution\n• Protection: 1h après défaite (toute attaque)\n\n🏅 **PROGRESSION:**\n• 1000 XP = +1 niveau + bonus unités + 50💰\n• Niveau up donne: +2 guerriers, +1 archer, +0.5 mage\n• Batailles donnent XP même en cas de défaite\n• Plus l'ennemi est fort, plus l'XP est importante\n\nMaîtrise ces mécaniques pour dominer le classement ! 👑`;

        default:
            const userClan = getUserClan();
            if (userClan) {
                if (!validateClanData(userClan)) {
                    return "❌ Données du clan corrompues ! Contacte un administrateur.";
                }
                
                const protection = isProtected(userClan) ? '🛡️ Protégé ' : '';
                const power = calculatePower(userClan);
                const role = isLeader() ? '👑 Chef' : '👤 Membre';
                
                return `🏰 **${userClan.name}** (${userClan.id}) ${protection}\n${role} • ⭐ Niv.${userClan.level} • 📊 ${power} pts\n👥 ${userClan.members.length}/${GAME_CONFIG.MAX_MEMBERS} • 💰 ${userClan.treasury}💰\n⚔️ ${userClan.units.w}🗡️ ${userClan.units.a}🏹 ${userClan.units.m}🔮\n\n💡 **COMMANDES RAPIDES:**\n• \`/clan info\` - Statistiques détaillées\n• \`/clan battle [cible]\` - Lancer une attaque\n• \`/clan strategy\` - Conseils personnalisés\n• \`/clan help\` - Guide complet\n\n🎯 **PROCHAINE ÉTAPE RECOMMANDÉE:**\n${userClan.members.length < 5 ? '👥 Recrute des membres pour +30 pts chacun !' : userClan.treasury >= 80 ? '🔮 Achète des mages (meilleur ratio) !' : power < 300 ? '⚔️ Lance des batailles pour gagner XP et or !' : '🏆 Tu es prêt à affronter les plus forts !'}`;
            } else {
                return `⚔️ **BIENVENUE DANS LE SYSTÈME DE CLANS ULTIME !**\n\n🌟 **Système nouvelle génération avec:**\n• Combat tactique avancé avec facteurs aléatoires\n• Calculs de puissance complexes et bonus\n• Système de protection et cooldowns intelligents\n• Économie équilibrée et stratégies multiples\n\n🚀 **DÉMARRAGE RAPIDE:**\n🏰 \`/clan create [nom]\` - Fonde ton empire\n📜 \`/clan list\` - Explore les rivaux\n❓ \`/clan help\` - Maîtrise toutes les mécaniques\n\n💎 **POURQUOI CRÉER UN CLAN ?**\n• Combats épiques avec système tactique\n• Progression par niveaux et expérience\n• Gestion d'armée et économie\n• Classements et compétition\n• Coopération et stratégies d'équipe\n\n🎯 **Crée ton clan maintenant et commence ta conquête !**\n\n💡 Tape \`/clan create [nom]\` pour débuter l'aventure !`;
    }
};

// === FONCTIONS UTILITAIRES EXPORTÉES ===

// Fonction de nettoyage automatique (à appeler périodiquement)
module.exports.cleanupClanData = async function(ctx) {
    if (!ctx.clanData) return;
    
    let cleaned = 0;
    const now = Date.now();
    
    // Nettoyer les invitations expirées (7 jours)
    Object.keys(ctx.clanData.invites).forEach(userId => {
        const validInvites = ctx.clanData.invites[userId].filter(clanId => {
            return ctx.clanData.clans[clanId]; // Clan existe encore
        });
        
        if (validInvites.length === 0) {
            delete ctx.clanData.invites[userId];
            cleaned++;
        } else if (validInvites.length !== ctx.clanData.invites[userId].length) {
            ctx.clanData.invites[userId] = validInvites;
            cleaned++;
        }
    });
    
    // Nettoyer les cooldowns de suppression expirés
    Object.keys(ctx.clanData.deletedClans).forEach(userId => {
        if (now - ctx.clanData.deletedClans[userId] > 7 * 24 * 60 * 60 * 1000) { // 7 jours
            delete ctx.clanData.deletedClans[userId];
            cleaned++;
        }
    });
    
    // Nettoyer les batailles anciennes (garder 30 jours)
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    Object.keys(ctx.clanData.battles).forEach(battleId => {
        if (ctx.clanData.battles[battleId].timestamp < thirtyDaysAgo) {
            delete ctx.clanData.battles[battleId];
            cleaned++;
        }
    });
    
    if (cleaned > 0) {
        await ctx.saveDataImmediate();
        ctx.log.info(`🧹 Nettoyage clans: ${cleaned} entrées supprimées`);
    }
};

// Fonction de validation globale
module.exports.validateAllClans = async function(ctx) {
    if (!ctx.clanData) return;
    
    let fixed = 0;
    
    Object.values(ctx.clanData.clans).forEach(clan => {
        if (!validateClanData(clan)) {
            ctx.log.warn(`🔧 Clan ${clan.name} (${clan.id}) corrigé automatiquement`);
            fixed++;
        }
    });
    
    if (fixed > 0) {
        await ctx.saveDataImmediate();
        ctx.log.info(`🔧 ${fixed} clans corrigés automatiquement`);
    }
};
