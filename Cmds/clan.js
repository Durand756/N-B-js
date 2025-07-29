const fs = require('fs');
const path = require('path');

// Configuration des coûts et valeurs
const CONFIG = {
  UNIT_COSTS: {
    fantassin: 50,
    archer: 75,
    chevalier: 150,
    mage: 250,
    dragon: 750
  },
  UNIT_STRENGTH: {
    fantassin: 1,
    archer: 1.5,
    chevalier: 3,
    mage: 5,
    dragon: 15
  },
  TACTICS: {
    frontale: 1.0,
    surprise: 1.3,
    siege: 0.8
  },
  RANKS: {
    0: { name: 'Bronze', bonus: 1.0, dailyGold: 100 },
    500: { name: 'Argent', bonus: 1.2, dailyGold: 150 },
    1500: { name: 'Or', bonus: 1.5, dailyGold: 200 },
    3000: { name: 'Légende', bonus: 2.0, dailyGold: 300 }
  },
  GRADES: ['Membre', 'Soldat', 'Général', 'Espion', 'Trésorier', 'Lieutenant', 'Chef'],
  BLASONS: ['🐺', '🦅', '🦁', '🐉', '⚔️', '🛡️', '🏰', '👑', '🔥', '❄️', '⚡', '🌟'],
  BASES: [
    'Forêt Obscure', 'Montagne Glacée', 'Désert Brûlant', 'Marais Mystique',
    'Vallée Perdue', 'Citadelle de Pierre', 'Tour de Cristal', 'Île Flottante',
    'Caverne Profonde', 'Plaine Éternelle', 'Jungle Sauvage', 'Toundra Gelée'
  ],
  COOLDOWNS: {
    attack: 5 * 60 * 1000,      // 5 minutes
    recruit: 2 * 60 * 1000,     // 2 minutes
    declare: 10 * 60 * 1000,    // 10 minutes
    daily_reward: 60 * 60 * 1000 // 1 heure
  }
};

class ClanSystem {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data', 'clan');
    this.clansFile = path.join(this.dataDir, 'clans.json');
    this.warsFile = path.join(this.dataDir, 'wars.json');
    this.timersFile = path.join(this.dataDir, 'timers.json');
    this.eventsFile = path.join(this.dataDir, 'events.json');
    this.requestsFile = path.join(this.dataDir, 'requests.json');
    this.ensureDataDir();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Initialiser les fichiers s'ils n'existent pas
    const files = [
      { file: this.clansFile, default: {} },
      { file: this.warsFile, default: {} },
      { file: this.timersFile, default: {} },
      { file: this.eventsFile, default: {} },
      { file: this.requestsFile, default: {} }
    ];

    files.forEach(({ file, default: defaultValue }) => {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
      }
    });
  }

  loadData(file) {
    try {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Erreur lors du chargement de ${file}:`, error);
      return {};
    }
  }

  saveData(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`Erreur lors de la sauvegarde de ${file}:`, error);
      return false;
    }
  }

  // Getters et setters pour les données
  getClans() { return this.loadData(this.clansFile); }
  saveClans(clans) { return this.saveData(this.clansFile, clans); }
  
  getWars() { return this.loadData(this.warsFile); }
  saveWars(wars) { return this.saveData(this.warsFile, wars); }
  
  getTimers() { return this.loadData(this.timersFile); }
  saveTimers(timers) { return this.saveData(this.timersFile, timers); }
  
  getEvents() { return this.loadData(this.eventsFile); }
  saveEvents(events) { return this.saveData(this.eventsFile, events); }
  
  getRequests() { return this.loadData(this.requestsFile); }
  saveRequests(requests) { return this.saveData(this.requestsFile, requests); }

  // Utilitaires
  getUserClan(userId) {
    const clans = this.getClans();
    for (const [clanName, clan] of Object.entries(clans)) {
      if (clan.membres && clan.membres[userId]) {
        return { name: clanName, data: clan };
      }
    }
    return null;
  }

  getRank(points) {
    const ranks = Object.keys(CONFIG.RANKS).map(p => parseInt(p)).sort((a, b) => b - a);
    for (const rankPoints of ranks) {
      if (points >= rankPoints) {
        return CONFIG.RANKS[rankPoints];
      }
    }
    return CONFIG.RANKS[0];
  }

  canPerformAction(userId, action) {
    const timers = this.getTimers();
    const userTimers = timers[userId] || {};
    const lastAction = userTimers[action];
    
    if (!lastAction) return true;
    
    const cooldown = CONFIG.COOLDOWNS[action] || 0;
    return Date.now() - lastAction > cooldown;
  }

  setActionTimer(userId, action) {
    const timers = this.getTimers();
    if (!timers[userId]) timers[userId] = {};
    timers[userId][action] = Date.now();
    this.saveTimers(timers);
  }

  getTimeRemaining(userId, action) {
    const timers = this.getTimers();
    const userTimers = timers[userId] || {};
    const lastAction = userTimers[action];
    
    if (!lastAction) return 0;
    
    const cooldown = CONFIG.COOLDOWNS[action] || 0;
    const remaining = cooldown - (Date.now() - lastAction);
    return Math.max(0, remaining);
  }

  formatTime(ms) {
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    } else if (minutes > 0) {
      return `${minutes}min${seconds > 0 ? ` ${seconds}s` : ''}`;
    } else {
      return `${seconds}s`;
    }
  }

  calculateForce(units) {
    let force = 0;
    for (const [type, count] of Object.entries(units || {})) {
      force += count * (CONFIG.UNIT_STRENGTH[type] || 0);
    }
    return force;
  }

  simulateBattle(attackerForce, defenderForce, tactic = 'frontale') {
    const tacticMultiplier = CONFIG.TACTICS[tactic] || 1.0;
    const adjustedAttackerForce = attackerForce * tacticMultiplier;
    
    // Facteur aléatoire (-20% à +20%)
    const attackerRoll = adjustedAttackerForce * (0.8 + Math.random() * 0.4);
    const defenderRoll = defenderForce * (0.8 + Math.random() * 0.4);
    
    const victory = attackerRoll > defenderRoll;
    const ratio = victory ? attackerRoll / defenderRoll : defenderRoll / attackerRoll;
    
    // Calcul des pertes (entre 10% et 40% des unités)
    const baseLoss = 0.1;
    const maxLoss = 0.4;
    const lossPercentage = Math.min(maxLoss, baseLoss + (2 - ratio) * 0.15);
    
    return {
      victory,
      ratio: Math.round(ratio * 100) / 100,
      attackerLosses: lossPercentage,
      defenderLosses: victory ? lossPercentage * 1.2 : lossPercentage * 0.8
    };
  }

  applyLosses(units, lossPercentage) {
    const losses = {};
    for (const [type, count] of Object.entries(units || {})) {
      const lost = Math.floor(count * lossPercentage);
      losses[type] = lost;
      units[type] = Math.max(0, count - lost);
    }
    return losses;
  }

  distributeLossesToMembers(clan, totalLosses) {
    const members = Object.values(clan.membres);
    
    for (const [unitType, totalLost] of Object.entries(totalLosses)) {
      let remaining = totalLost;
      
      // Calculer le total de ce type d'unité dans le clan
      const totalUnits = members.reduce((sum, member) => 
        sum + (member.unites[unitType] || 0), 0);
      
      if (totalUnits === 0) continue;
      
      // Distribuer les pertes proportionnellement
      for (const member of members) {
        if (remaining <= 0) break;
        
        const memberUnits = member.unites[unitType] || 0;
        if (memberUnits === 0) continue;
        
        const memberRatio = memberUnits / totalUnits;
        const memberLosses = Math.min(remaining, Math.floor(totalLost * memberRatio));
        
        member.unites[unitType] = Math.max(0, memberUnits - memberLosses);
        remaining -= memberLosses;
      }
    }
  }

  // Commandes principales
  async processCommand(userId, userPseudo, args) {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'create':
        return this.createClan(userId, userPseudo, args.slice(1).join(' '));
      case 'join':
        return this.requestJoinClan(userId, userPseudo, args[1]);
      case 'accept':
        return this.acceptJoinRequest(userId, args[1]);
      case 'reject':
        return this.rejectJoinRequest(userId, args[1]);
      case 'leave':
        return this.leaveClan(userId);
      case 'info':
        return this.getClanInfo(userId, args[1]);
      case 'promote':
        return this.promoteMember(userId, args[1], args[2]);
      case 'kick':
        return this.kickMember(userId, args[1]);
      case 'recruit':
        return this.recruitUnits(userId, args[1], parseInt(args[2]) || 1);
      case 'declare':
        return this.declareWar(userId, args[1]);
      case 'attack':
        return this.attackClan(userId, args[1] || 'frontale');
      case 'defend':
        return this.defendClan(userId);
      case 'peace':
        return this.proposePeace(userId, args.slice(1).join(' '));
      case 'ranking':
        return this.getClanRanking();
      case 'daily':
        return this.claimDailyReward(userId);
      case 'donate':
        return this.donateGold(userId, parseInt(args[1]) || 0);
      case 'wars':
        return this.getActiveWars();
      case 'stats':
        return this.getClanStats(userId);
      case 'help':
        return this.getHelp();
      default:
        return this.getQuickHelp();
    }
  }

  createClan(userId, userPseudo, clanName) {
    if (!clanName || clanName.trim().length === 0) {
      return "❌ **Erreur:** Spécifie un nom pour ton clan !\n`/clan create [NomClan]`";
    }

    clanName = clanName.trim();
    
    if (clanName.length > 20) {
      return "❌ **Erreur:** Le nom du clan ne peut pas dépasser 20 caractères !";
    }

    const clans = this.getClans();
    
    // Vérifier si le clan existe déjà (insensible à la casse)
    const existingClan = Object.keys(clans).find(name => 
      name.toLowerCase() === clanName.toLowerCase()
    );
    
    if (existingClan) {
      return `❌ **Erreur:** Le clan "${existingClan}" existe déjà !`;
    }

    if (this.getUserClan(userId)) {
      return "❌ **Erreur:** Tu fais déjà partie d'un clan ! Quitte-le d'abord avec `/clan leave`";
    }

    const blason = CONFIG.BLASONS[Math.floor(Math.random() * CONFIG.BLASONS.length)];
    const base = CONFIG.BASES[Math.floor(Math.random() * CONFIG.BASES.length)];

    clans[clanName] = {
      blason,
      chef: userId,
      base,
      or: 1000,
      points: 0,
      statut: "neutre",
      createdAt: Date.now(),
      lastDailyReward: 0,
      territoires: 1,
      defenseBonuses: {},
      membres: {
        [userId]: {
          pseudo: userPseudo,
          grade: "Chef",
          unites: { 
            fantassin: 5, 
            archer: 3 
          },
          pointsPerso: 0,
          joinedAt: Date.now(),
          donations: 0
        }
      }
    };

    this.saveClans(clans);

    return `🏰 **Clan créé avec succès !**\n\n` +
           `${blason} **${clanName}**\n` +
           `📍 **Base:** ${base}\n` +
           `👑 **Chef:** ${userPseudo}\n` +
           `💰 **Or:** 1,000\n` +
           `⭐ **Points:** 0\n` +
           `🏴 **Territoires:** 1\n\n` +
           `🛡️ **Armée de départ:**\n` +
           `• Fantassins: 5\n` +
           `• Archers: 3\n\n` +
           `Ton clan est maintenant opérationnel ! Utilise \`/clan help\` pour voir toutes les commandes disponibles.`;
  }

  requestJoinClan(userId, userPseudo, clanName) {
    if (!clanName) {
      return "❌ **Erreur:** Spécifie le nom du clan à rejoindre !\n`/clan join [NomClan]`";
    }

    const clans = this.getClans();
    
    // Recherche insensible à la casse
    const foundClan = Object.keys(clans).find(name => 
      name.toLowerCase() === clanName.toLowerCase()
    );
    
    if (!foundClan) {
      return `❌ **Erreur:** Le clan "${clanName}" n'existe pas !`;
    }

    if (this.getUserClan(userId)) {
      return "❌ **Erreur:** Tu fais déjà partie d'un clan !";
    }

    const requests = this.getRequests();
    const requestId = `${userId}_${foundClan}`;

    if (requests[requestId]) {
      return `⏳ **Demande en attente**\n\nTu as déjà une demande en cours pour rejoindre **${foundClan}**.`;
    }

    requests[requestId] = {
      userId,
      userPseudo,
      clanName: foundClan,
      timestamp: Date.now()
    };

    this.saveRequests(requests);

    return `📨 **Demande envoyée !**\n\n` +
           `Ta demande pour rejoindre **${foundClan}** a été envoyée au chef du clan.\n` +
           `Tu recevras une notification quand elle sera traitée.`;
  }

  acceptJoinRequest(userId, targetPseudo) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const member = userClan.data.membres[userId];
    if (!member || !['Chef', 'Lieutenant'].includes(member.grade)) {
      return "❌ **Erreur:** Seuls les Chefs et Lieutenants peuvent accepter des demandes !";
    }

    const requests = this.getRequests();
    const requestEntry = Object.entries(requests).find(([_, request]) => 
      request.clanName === userClan.name && request.userPseudo === targetPseudo
    );

    if (!requestEntry) {
      return `❌ **Erreur:** Aucune demande trouvée pour **${targetPseudo}**.`;
    }

    const [requestId, request] = requestEntry;
    const clans = this.getClans();

    // Ajouter le membre au clan
    clans[userClan.name].membres[request.userId] = {
      pseudo: request.userPseudo,
      grade: "Membre",
      unites: { fantassin: 2 },
      pointsPerso: 0,
      joinedAt: Date.now(),
      donations: 0
    };

    // Supprimer la demande
    delete requests[requestId];

    this.saveClans(clans);
    this.saveRequests(requests);

    return `✅ **Membre accepté !**\n\n` +
           `**${request.userPseudo}** a rejoint le clan **${userClan.name}** !\n` +
           `👥 **Membres:** ${Object.keys(clans[userClan.name].membres).length}`;
  }

  rejectJoinRequest(userId, targetPseudo) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const member = userClan.data.membres[userId];
    if (!member || !['Chef', 'Lieutenant'].includes(member.grade)) {
      return "❌ **Erreur:** Seuls les Chefs et Lieutenants peuvent rejeter des demandes !";
    }

    const requests = this.getRequests();
    const requestEntry = Object.entries(requests).find(([_, request]) => 
      request.clanName === userClan.name && request.userPseudo === targetPseudo
    );

    if (!requestEntry) {
      return `❌ **Erreur:** Aucune demande trouvée pour **${targetPseudo}**.`;
    }

    const [requestId] = requestEntry;
    delete requests[requestId];
    this.saveRequests(requests);

    return `❌ **Demande rejetée**\n\nLa demande de **${targetPseudo}** a été rejetée.`;
  }

  leaveClan(userId) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clans = this.getClans();
    const clan = clans[userClan.name];

    if (clan.chef === userId) {
      // Transférer le leadership ou dissoudre le clan
      const otherMembers = Object.keys(clan.membres).filter(id => id !== userId);
      if (otherMembers.length > 0) {
        // Choisir le lieutenant le plus ancien, sinon le membre le plus ancien
        const lieutenants = otherMembers.filter(id => 
          clan.membres[id].grade === 'Lieutenant'
        );
        
        const newChef = lieutenants.length > 0 ? 
          lieutenants.sort((a, b) => clan.membres[a].joinedAt - clan.membres[b].joinedAt)[0] :
          otherMembers.sort((a, b) => clan.membres[a].joinedAt - clan.membres[b].joinedAt)[0];

        clan.chef = newChef;
        clan.membres[newChef].grade = "Chef";
        
        delete clan.membres[userId];
        this.saveClans(clans);
        
        return `✅ **Clan transféré**\n\n` +
               `Tu as quitté **${userClan.name}**.\n` +
               `Le leadership a été transféré à **${clan.membres[newChef].pseudo}**.`;
      } else {
        // Dissoudre le clan
        delete clans[userClan.name];
        this.saveClans(clans);
        return `🏰 **Clan dissous**\n\nLe clan **${userClan.name}** a été dissous car tu étais le dernier membre.`;
      }
    }

    delete clan.membres[userId];
    this.saveClans(clans);

    return `✅ **Clan quitté**\n\nTu as quitté le clan **${userClan.name}**.`;
  }

  getClanInfo(userId, targetClan = null) {
    let clan, clanName;
    
    if (targetClan) {
      const clans = this.getClans();
      const foundClan = Object.keys(clans).find(name => 
        name.toLowerCase() === targetClan.toLowerCase()
      );
      
      if (!foundClan) {
        return `❌ **Erreur:** Le clan "${targetClan}" n'existe pas !`;
      }
      
      clanName = foundClan;
      clan = clans[foundClan];
    } else {
      const userClan = this.getUserClan(userId);
      if (!userClan) {
        return "❌ **Erreur:** Tu ne fais partie d'aucun clan ! Utilise `/clan info [NomClan]` pour voir un autre clan.";
      }
      clanName = userClan.name;
      clan = userClan.data;
    }

    const rank = this.getRank(clan.points);
    const membersList = Object.entries(clan.membres)
      .sort(([,a], [,b]) => {
        const gradeOrder = { 'Chef': 0, 'Lieutenant': 1, 'Trésorier': 2, 'Général': 3, 'Espion': 4, 'Soldat': 5, 'Membre': 6 };
        return (gradeOrder[a.grade] || 6) - (gradeOrder[b.grade] || 6);
      })
      .map(([id, member]) => {
        const isUser = id === userId;
        const prefix = isUser ? '👤' : '•';
        return `${prefix} **${member.pseudo}** (${member.grade})`;
      })
      .join('\n');

    // Calculer l'armée totale
    const totalUnits = Object.values(clan.membres).reduce((total, member) => {
      for (const [type, count] of Object.entries(member.unites || {})) {
        total[type] = (total[type] || 0) + count;
      }
      return total;
    }, {});

    const unitsDisplay = Object.entries(totalUnits)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ') || 'Aucune unité';

    const totalForce = this.calculateForce(totalUnits);
    
    // Informations sur les guerres
    const wars = this.getWars();
    const activeWar = Object.values(wars).find(war => 
      war.attacker === clanName || war.defender === clanName
    );

    let warInfo = '';
    if (activeWar) {
      const enemy = activeWar.attacker === clanName ? activeWar.defender : activeWar.attacker;
      const timeLeft = Math.max(0, activeWar.preparationEnd - Date.now());
      
      if (timeLeft > 0) {
        warInfo = `⚔️ **Guerre:** Préparation contre **${enemy}** (${this.formatTime(timeLeft)})\n`;
      } else {
        warInfo = `⚔️ **Guerre:** Combat actif contre **${enemy}**\n`;
      }
    }

    // Demandes en attente (seulement pour les membres du clan)
    let requestsInfo = '';
    if (!targetClan || this.getUserClan(userId)?.name === clanName) {
      const requests = this.getRequests();
      const pendingRequests = Object.values(requests).filter(req => req.clanName === clanName);
      
      if (pendingRequests.length > 0) {
        requestsInfo = `\n📨 **Demandes en attente (${pendingRequests.length}):**\n` +
          pendingRequests.map(req => `• ${req.userPseudo}`).join('\n') + '\n';
      }
    }

    return `${clan.blason} **${clanName}**\n\n` +
           `👑 **Chef:** ${clan.membres[clan.chef]?.pseudo || 'Inconnu'}\n` +
           `📍 **Base:** ${clan.base}\n` +
           `💰 **Or:** ${clan.or.toLocaleString()}\n` +
           `⭐ **Points:** ${clan.points}\n` +
           `🏆 **Rang:** ${rank.name}\n` +
           `🏴 **Territoires:** ${clan.territoires || 1}\n` +
           `⚡ **Force totale:** ${totalForce}\n` +
           warInfo +
           `📅 **Créé le:** ${new Date(clan.createdAt).toLocaleDateString()}\n\n` +
           `👥 **Membres (${Object.keys(clan.membres).length}):**\n${membersList}\n\n` +
           `🛡️ **Armée totale:** ${unitsDisplay}` +
           requestsInfo;
  }

  promoteMember(userId, targetPseudo, grade) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clan = userClan.data;
    const userMember = clan.membres[userId];

    if (!userMember || userMember.grade !== "Chef") {
      return "❌ **Erreur:** Seul le Chef peut promouvoir des membres !";
    }

    if (!grade || !CONFIG.GRADES.includes(grade)) {
      return `❌ **Erreur:** Grade invalide !\n**Grades disponibles:** ${CONFIG.GRADES.filter(g => g !== 'Chef').join(', ')}`;
    }

    if (grade === 'Chef') {
      return "❌ **Erreur:** Tu ne peux pas promouvoir quelqu'un Chef ! Utilise `/clan leave` pour transférer le leadership.";
    }

    // Trouver le membre à promouvoir
    const targetId = Object.keys(clan.membres).find(id => 
      clan.membres[id].pseudo.toLowerCase() === targetPseudo.toLowerCase()
    );

    if (!targetId) {
      return `❌ **Erreur:** Membre "${targetPseudo}" introuvable dans le clan !`;
    }

    if (targetId === userId) {
      return "❌ **Erreur:** Tu ne peux pas te promouvoir toi-même !";
    }

    const clans = this.getClans();
    const oldGrade = clans[userClan.name].membres[targetId].grade;
    clans[userClan.name].membres[targetId].grade = grade;
    this.saveClans(clans);

    return `✅ **Promotion réussie !**\n\n` +
           `**${targetPseudo}** a été promu de **${oldGrade}** à **${grade}** !`;
  }

  kickMember(userId, targetPseudo) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clan = userClan.data;
    const userMember = clan.membres[userId];

    if (!userMember || !['Chef', 'Lieutenant'].includes(userMember.grade)) {
      return "❌ **Erreur:** Seuls les Chefs et Lieutenants peuvent expulser des membres !";
    }

    // Trouver le membre à expulser
    const targetId = Object.keys(clan.membres).find(id => 
      clan.membres[id].pseudo.toLowerCase() === targetPseudo.toLowerCase()
    );

    if (!targetId) {
      return `❌ **Erreur:** Membre "${targetPseudo}" introuvable dans le clan !`;
    }

    if (targetId === userId) {
      return "❌ **Erreur:** Tu ne peux pas t'expulser toi-même ! Utilise `/clan leave`.";
    }

    if (targetId === clan.chef) {
      return "❌ **Erreur:** Tu ne peux pas expulser le Chef !";
    }

    // Un Lieutenant ne peut pas expulser un autre Lieutenant
    const targetMember = clan.membres[targetId];
    if (userMember.grade === 'Lieutenant' && targetMember.grade === 'Lieutenant') {
      return "❌ **Erreur:** Un Lieutenant ne peut pas expulser un autre Lieutenant !";
    }

    const clans = this.getClans();
    delete clans[userClan.name].membres[targetId];
    this.saveClans(clans);

    return `✅ **Membre expulsé !**\n\n` +
           `**${targetPseudo}** a été expulsé du clan **${userClan.name}**.`;
  }

  recruitUnits(userId, unitType, quantity) {
    if (!this.canPerformAction(userId, 'recruit')) {
      const timeLeft = this.getTimeRemaining(userId, 'recruit');
      return `⏳ **Cooldown actif !** Tu peux recruter dans ${this.formatTime(timeLeft)}.`;
    }

    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    if (!unitType || !CONFIG.UNIT_COSTS[unitType]) {
      const validTypes = Object.keys(CONFIG.UNIT_COSTS).join(', ');
      return `❌ **Erreur:** Type d'unité invalide !\n**Types disponibles:** ${validTypes}`;
    }

    if (quantity <= 0 || quantity > 100) {
      return "❌ **Erreur:** La quantité doit être entre 1 et 100 !";
    }

    const cost = CONFIG.UNIT_COSTS[unitType] * quantity;
    const clan = userClan.data;

    if (clan.or < cost) {
      return `❌ **Or insuffisant !**\n\n` +
             `💰 **Coût:** ${cost.toLocaleString()} or\n` +
             `💰 **Disponible:** ${clan.or.toLocaleString()} or\n` +
             `💰 **Manque:** ${(cost - clan.or).toLocaleString()} or`;
    }

    const clans = this.getClans();
    clans[userClan.name].or -= cost;
    
    const member = clans[userClan.name].membres[userId];
    if (!member.unites[unitType]) {
      member.unites[unitType] = 0;
    }
    member.unites[unitType] += quantity;

    this.saveClans(clans);
    this.setActionTimer(userId, 'recruit');

    const unitEmoji = {
      fantassin: '⚔️',
      archer: '🏹',
      chevalier: '🐎',
      mage: '🔮',
      dragon: '🐉'
    };

    return `${unitEmoji[unitType]} **Recrutement réussi !**\n\n` +
           `📈 **+${quantity} ${unitType}(s)** ajouté(s) à ton armée\n` +
           `💰 **-${cost.toLocaleString()} or** (Reste: ${clans[userClan.name].or.toLocaleString()} or)\n` +
           `⏳ **Prochain recrutement:** 2 minutes`;
  }

  declareWar(userId, targetClanName) {
    if (!this.canPerformAction(userId, 'declare')) {
      const timeLeft = this.getTimeRemaining(userId, 'declare');
      return `⏳ **Cooldown actif !** Tu peux déclarer la guerre dans ${this.formatTime(timeLeft)}.`;
    }

    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clan = userClan.data;
    const userMember = clan.membres[userId];

    if (!userMember || userMember.grade !== "Chef") {
      return "❌ **Erreur:** Seul le Chef peut déclarer la guerre !";
    }

    const clans = this.getClans();
    const foundTargetClan = Object.keys(clans).find(name => 
      name.toLowerCase() === targetClanName.toLowerCase()
    );

    if (!foundTargetClan) {
      return `❌ **Erreur:** Le clan "${targetClanName}" n'existe pas !`;
    }

    if (foundTargetClan === userClan.name) {
      return "❌ **Erreur:** Tu ne peux pas déclarer la guerre à ton propre clan !";
    }

    // Vérifier si une guerre est déjà active
    const wars = this.getWars();
    const existingWar = Object.values(wars).find(war => 
      (war.attacker === userClan.name && war.defender === foundTargetClan) ||
      (war.attacker === foundTargetClan && war.defender === userClan.name)
    );

    if (existingWar) {
      return `⚔️ **Guerre déjà active !**\n\nUne guerre est déjà en cours entre **${userClan.name}** et **${foundTargetClan}**.`;
    }

    const warId = `${userClan.name}_vs_${foundTargetClan}_${Date.now()}`;
    const preparationTime = 5 * 60 * 1000; // 5 minutes

    wars[warId] = {
      attacker: userClan.name,
      defender: foundTargetClan,
      startTime: Date.now(),
      preparationEnd: Date.now() + preparationTime,
      status: "preparation"
    };

    clans[userClan.name].statut = `guerre avec ${foundTargetClan}`;
    clans[foundTargetClan].statut = `guerre avec ${userClan.name}`;

    this.saveWars(wars);
    this.saveClans(clans);
    this.setActionTimer(userId, 'declare');

    const targetClan = clans[foundTargetClan];

    return `⚔️ **GUERRE DÉCLARÉE !**\n\n` +
           `${clan.blason} **${userClan.name}** VS ${targetClan.blason} **${foundTargetClan}**\n\n` +
           `⏳ **Période de préparation:** 5 minutes\n` +
           `🛡️ **Consignes:**\n` +
           `• Recrutez des unités avec \`/clan recruit\`\n` +
           `• Renforcez vos défenses avec \`/clan defend\`\n` +
           `• L'attaque sera possible après la préparation\n\n` +
           `🎯 **Préparez-vous pour la bataille !**`;
  }

  attackClan(userId, tactic = 'frontale') {
    if (!this.canPerformAction(userId, 'attack')) {
      const timeLeft = this.getTimeRemaining(userId, 'attack');
      return `⏳ **Cooldown actif !** Tu peux attaquer dans ${this.formatTime(timeLeft)}.`;
    }

    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const validTactics = Object.keys(CONFIG.TACTICS);
    if (!validTactics.includes(tactic)) {
      return `❌ **Tactique invalide !**\n**Tactiques disponibles:** ${validTactics.join(', ')}`;
    }

    const wars = this.getWars();
    const activeWar = Object.values(wars).find(war => 
      (war.attacker === userClan.name || war.defender === userClan.name) && 
      war.status === "preparation"
    );

    if (!activeWar) {
      return "❌ **Erreur:** Aucune guerre active ! Déclare d'abord la guerre avec `/clan declare [clan]`.";
    }

    if (Date.now() < activeWar.preparationEnd) {
      const timeLeft = activeWar.preparationEnd - Date.now();
      return `⏳ **Période de préparation !**\n\nLa bataille commencera dans ${this.formatTime(timeLeft)}.`;
    }

    const enemyClanName = activeWar.attacker === userClan.name ? activeWar.defender : activeWar.attacker;
    const clans = this.getClans();
    const userClanData = clans[userClan.name];
    const enemyClan = clans[enemyClanName];

    if (!enemyClan) {
      return "❌ **Erreur:** Le clan ennemi n'existe plus !";
    }

    // Calculer les armées
    const userUnits = this.getTotalClanUnits(userClanData);
    const enemyUnits = this.getTotalClanUnits(enemyClan);

    const userForce = this.calculateForce(userUnits);
    const enemyForce = this.calculateForce(enemyUnits);

    if (userForce === 0) {
      return "❌ **Erreur:** Ton clan n'a aucune unité pour attaquer !";
    }

    // Simuler la bataille
    const battleResult = this.simulateBattle(userForce, enemyForce, tactic);

    // Appliquer les pertes
    const userLosses = this.applyLosses(userUnits, battleResult.attackerLosses);
    const enemyLosses = this.applyLosses(enemyUnits, battleResult.defenderLosses);

    // Distribuer les pertes aux membres
    this.distributeLossesToMembers(userClanData, userLosses);
    this.distributeLossesToMembers(enemyClan, enemyLosses);

    let result = "";
    let goldGained = 0;
    let pointsGained = 0;

    if (battleResult.victory) {
      goldGained = Math.floor(enemyClan.or * 0.25 + Math.random() * enemyClan.or * 0.15);
      pointsGained = Math.floor(50 + enemyClan.points * 0.1 + Math.random() * 30);
      
      userClanData.or += goldGained;
      userClanData.points += pointsGained;
      enemyClan.or = Math.max(0, enemyClan.or - goldGained);
      
      // Bonus de territoires pour le vainqueur
      if (Math.random() < 0.3) { // 30% de chance
        userClanData.territoires = (userClanData.territoires || 1) + 1;
        result = `🎉 **VICTOIRE ÉCLATANTE !**\n\n` +
                `💰 **+${goldGained.toLocaleString()} or** pillé\n` +
                `⭐ **+${pointsGained} points** de prestige\n` +
                `🏴 **+1 territoire** conquis !\n`;
      } else {
        result = `🎉 **VICTOIRE !**\n\n` +
                `💰 **+${goldGained.toLocaleString()} or** pillé\n` +
                `⭐ **+${pointsGained} points** de prestige\n`;
      }
    } else {
      // Défaite - perdre des points et de l'or
      const goldLost = Math.floor(userClanData.or * 0.1);
      const pointsLost = Math.floor(userClanData.points * 0.05);
      
      userClanData.or = Math.max(0, userClanData.or - goldLost);
      userClanData.points = Math.max(0, userClanData.points - pointsLost);
      
      result = `💀 **DÉFAITE CUISANTE !**\n\n` +
              `💸 **-${goldLost.toLocaleString()} or** perdu\n` +
              `📉 **-${pointsLost} points** de prestige\n` +
              `😔 Lourdes pertes subies...\n`;
    }

    // Finir la guerre
    const warId = Object.keys(wars).find(id => wars[id] === activeWar);
    delete wars[warId];
    userClanData.statut = "neutre";
    enemyClan.statut = "neutre";

    this.saveClans(clans);
    this.saveWars(wars);
    this.setActionTimer(userId, 'attack');

    // Affichage des pertes
    const userLossesText = Object.entries(userLosses)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${type}: -${count}`)
      .join(', ') || 'Aucune';

    const enemyLossesText = Object.entries(enemyLosses)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${type}: -${count}`)
      .join(', ') || 'Aucune';

    const tacticEmoji = {
      frontale: '⚔️',
      surprise: '🗡️',
      siege: '🏰'
    };

    return result +
           `${tacticEmoji[tactic]} **Tactique:** ${tactic} (x${CONFIG.TACTICS[tactic]})\n` +
           `⚡ **Force déployée:** ${userForce} vs ${enemyForce}\n` +
           `📊 **Ratio:** ${battleResult.ratio}\n\n` +
           `💔 **Tes pertes:** ${userLossesText}\n` +
           `💀 **Pertes ennemies:** ${enemyLossesText}\n\n` +
           `🏁 **La guerre contre ${enemyClanName} est terminée.**`;
  }

  getTotalClanUnits(clan) {
    return Object.values(clan.membres).reduce((total, member) => {
      for (const [type, count] of Object.entries(member.unites || {})) {
        total[type] = (total[type] || 0) + count;
      }
      return total;
    }, {});
  }

  defendClan(userId) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const wars = this.getWars();
    const activeWar = Object.values(wars).find(war => 
      war.attacker === userClan.name || war.defender === userClan.name
    );

    if (!activeWar) {
      return "❌ **Erreur:** Ton clan n'est pas en guerre ! Utilise cette commande pendant une guerre pour renforcer tes défenses.";
    }

    const clans = this.getClans();
    const clan = clans[userClan.name];

    // Améliorer les bonus défensifs
    if (!clan.defenseBonuses) clan.defenseBonuses = {};
    
    const bonusTypes = ['pièges', 'tours', 'murailles', 'fossés'];
    const randomBonus = bonusTypes[Math.floor(Math.random() * bonusTypes.length)];
    
    clan.defenseBonuses[randomBonus] = (clan.defenseBonuses[randomBonus] || 0) + 1;
    
    // Coût en or
    const cost = 100 + (clan.defenseBonuses[randomBonus] * 50);
    
    if (clan.or < cost) {
      return `❌ **Or insuffisant !**\n\nCoût pour améliorer les ${randomBonus}: ${cost} or`;
    }

    clan.or -= cost;
    this.saveClans(clans);

    const defenseEmoji = {
      pièges: '🪤',
      tours: '🗼',
      murailles: '🧱',
      fossés: '🕳️'
    };

    return `🛡️ **Défenses renforcées !**\n\n` +
           `${defenseEmoji[randomBonus]} **${randomBonus.charAt(0).toUpperCase() + randomBonus.slice(1)}** amélioré(e)s (Niveau ${clan.defenseBonuses[randomBonus]})\n` +
           `💰 **Coût:** ${cost} or\n` +
           `⚡ **Bonus défensif:** +${clan.defenseBonuses[randomBonus] * 5}%\n\n` +
           `Tes défenses sont maintenant plus solides pour la prochaine bataille !`;
  }

  proposePeace(userId, terms = '') {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const member = userClan.data.membres[userId];
    if (!member || !['Chef', 'Lieutenant'].includes(member.grade)) {
      return "❌ **Erreur:** Seuls les Chefs et Lieutenants peuvent proposer la paix !";
    }

    const wars = this.getWars();
    const activeWar = Object.values(wars).find(war => 
      war.attacker === userClan.name || war.defender === userClan.name
    );

    if (!activeWar) {
      return "❌ **Erreur:** Ton clan n'est pas en guerre !";
    }

    const enemyClanName = activeWar.attacker === userClan.name ? activeWar.defender : activeWar.attacker;

    // Proposer automatiquement la paix (simplifié pour cette version)
    const warId = Object.keys(wars).find(id => wars[id] === activeWar);
    delete wars[warId];

    const clans = this.getClans();
    clans[userClan.name].statut = "neutre";
    clans[enemyClanName].statut = "neutre";

    this.saveWars(wars);
    this.saveClans(clans);

    return `🕊️ **PAIX DÉCLARÉE !**\n\n` +
           `La guerre entre **${userClan.name}** et **${enemyClanName}** est terminée.\n\n` +
           `📜 **Termes:** ${terms || 'Paix sans condition'}\n\n` +
           `Les deux clans peuvent maintenant reprendre leurs activités normales.`;
  }

  getClanRanking() {
    const clans = this.getClans();
    const ranking = Object.entries(clans)
      .map(([name, clan]) => ({
        name,
        points: clan.points,
        blason: clan.blason,
        membres: Object.keys(clan.membres).length,
        or: clan.or,
        territoires: clan.territoires || 1
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 15);

    if (ranking.length === 0) {
      return "📊 **Aucun clan n'existe encore !**\n\nSois le premier à créer un clan avec `/clan create [nom]` !";
    }

    let result = "🏆 **CLASSEMENT DES CLANS**\n\n";
    
    ranking.forEach((clan, index) => {
      const rank = this.getRank(clan.points);
      let medal = '';
      
      if (index === 0) medal = '🥇';
      else if (index === 1) medal = '🥈';
      else if (index === 2) medal = '🥉';
      else medal = `**${index + 1}.**`;
      
      result += `${medal} ${clan.blason} **${clan.name}**\n` +
                `   ⭐ ${clan.points} pts • 👥 ${clan.membres} • 🏴 ${clan.territoires} • 🏆 ${rank.name}\n\n`;
    });

    return result + `📈 **Classement mis à jour en temps réel**`;
  }

  claimDailyReward(userId) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clan = userClan.data;
    const now = Date.now();
    const lastReward = clan.lastDailyReward || 0;
    const oneDayMs = CONFIG.COOLDOWNS.daily_reward;

    if (now - lastReward < oneDayMs) {
      const timeLeft = oneDayMs - (now - lastReward);
      return `⏳ **Récompense déjà réclamée !**\n\nProchaine récompense dans ${this.formatTime(timeLeft)}.`;
    }

    const rank = this.getRank(clan.points);
    const baseReward = rank.dailyGold;
    const memberBonus = Math.floor(Object.keys(clan.membres).length / 3) * 25;
    const territoryBonus = (clan.territoires || 1) * 20;
    const totalReward = baseReward + memberBonus + territoryBonus;

    const clans = this.getClans();
    clans[userClan.name].or += totalReward;
    clans[userClan.name].lastDailyReward = now;
    this.saveClans(clans);

    return `💰 **RÉCOMPENSE QUOTIDIENNE !**\n\n` +
           `🏆 **Rang ${rank.name}:** ${baseReward} or\n` +
           `👥 **Bonus membres:** ${memberBonus} or\n` +
           `🏴 **Bonus territoires:** ${territoryBonus} or\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `💎 **Total:** ${totalReward.toLocaleString()} or ajouté !\n\n` +
           `💰 **Or du clan:** ${clans[userClan.name].or.toLocaleString()}`;
  }

  donateGold(userId, amount) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    if (amount <= 0) {
      return "❌ **Erreur:** Le montant doit être positif !";
    }

    // Pour cette version simplifiée, on suppose que les utilisateurs ont de l'or personnel
    // Dans une vraie implémentation, il faudrait un système d'économie personnelle
    return "💡 **Fonctionnalité à venir !**\n\nLe système de don personnel sera ajouté dans une prochaine mise à jour.";
  }

  getActiveWars() {
    const wars = this.getWars();
    const activeWars = Object.values(wars);

    if (activeWars.length === 0) {
      return "🕊️ **Aucune guerre active**\n\nTous les clans sont en paix pour le moment.";
    }

    let result = "⚔️ **GUERRES ACTIVES**\n\n";

    activeWars.forEach(war => {
      const timeLeft = Math.max(0, war.preparationEnd - Date.now());
      const status = timeLeft > 0 ? 
        `🛡️ Préparation (${this.formatTime(timeLeft)})` : 
        `⚔️ Combat actif`;

      result += `**${war.attacker}** VS **${war.defender}**\n` +
                `📍 **Statut:** ${status}\n` +
                `📅 **Début:** ${new Date(war.startTime).toLocaleString()}\n\n`;
    });

    return result;
  }

  getClanStats(userId) {
    const userClan = this.getUserClan(userId);
    if (!userClan) {
      return "❌ **Erreur:** Tu ne fais partie d'aucun clan !";
    }

    const clan = userClan.data;
    const member = clan.membres[userId];
    
    // Statistiques personnelles
    const personalUnits = Object.entries(member.unites || {})
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ') || 'Aucune';

    const personalForce = this.calculateForce(member.unites || {});

    // Statistiques du clan
    const totalUnits = this.getTotalClanUnits(clan);
    const totalForce = this.calculateForce(totalUnits);
    const rank = this.getRank(clan.points);

    return `📊 **STATISTIQUES**\n\n` +
           `👤 **Tes stats personnelles:**\n` +
           `• **Grade:** ${member.grade}\n` +
           `• **Armée:** ${personalUnits}\n` +
           `• **Force:** ${personalForce}\n` +
           `• **Points:** ${member.pointsPerso || 0}\n` +
           `• **Membre depuis:** ${new Date(member.joinedAt).toLocaleDateString()}\n\n` +
           `${clan.blason} **Stats du clan ${userClan.name}:**\n` +
           `• **Membres:** ${Object.keys(clan.membres).length}\n` +
           `• **Or total:** ${clan.or.toLocaleString()}\n` +
           `• **Points:** ${clan.points}\n` +
           `• **Rang:** ${rank.name}\n` +
           `• **Force totale:** ${totalForce}\n` +
           `• **Territoires:** ${clan.territoires || 1}\n` +
           `• **Créé le:** ${new Date(clan.createdAt).toLocaleDateString()}`;
  }

  getHelp() {
    return `⚔️ **GUIDE COMPLET DU SYSTÈME DE CLAN**\n\n` +
           `**🏰 GESTION DE CLAN:**\n` +
           `• \`/clan create [nom]\` - Créer un clan\n` +
           `• \`/clan join [nom]\` - Demander à rejoindre un clan\n` +
           `• \`/clan accept [pseudo]\` - Accepter une demande\n` +
           `• \`/clan reject [pseudo]\` - Rejeter une demande\n` +
           `• \`/clan leave\` - Quitter son clan\n` +
           `• \`/clan info [clan]\` - Voir les infos d'un clan\n` +
           `• \`/clan promote [pseudo] [grade]\` - Promouvoir\n` +
           `• \`/clan kick [pseudo]\` - Expulser un membre\n\n` +
           `**⚔️ GUERRE ET COMBAT:**\n` +
           `• \`/clan declare [clan]\` - Déclarer la guerre\n` +
           `• \`/clan attack [tactique]\` - Attaquer (frontale/surprise/siege)\n` +
           `• \`/clan defend\` - Renforcer les défenses\n` +
           `• \`/clan peace [termes]\` - Proposer la paix\n` +
           `• \`/clan wars\` - Voir les guerres actives\n\n` +
           `**🛡️ ARMÉE ET RESSOURCES:**\n` +
           `• \`/clan recruit [type] [qté]\` - Recruter des unités\n` +
           `• **Types:** fantassin (50), archer (75), chevalier (150), mage (250), dragon (750)\n` +
           `• \`/clan daily\` - Récompense quotidienne\n\n` +
           `**📊 INFORMATION:**\n` +
           `• \`/clan ranking\` - Classement des clans\n` +
           `• \`/clan stats\` - Tes statistiques\n\n` +
           `**💡 CONSEILS:**\n` +
           `• Chaque rang donne plus d'or quotidien\n` +
           `• Les guerres ont 2h de préparation\n` +
           `• Cooldowns: Attaque 12h, Recrutement 30min, Guerre 24h\n` +
           `• Grades: Membre → Soldat → Général/Espion/Trésorier → Lieutenant → Chef`;
  }

  getQuickHelp() {
    return `⚔️ **COMMANDES CLAN DISPONIBLES:**\n\n` +
           `**🏰 Base:** create, join, leave, info, promote\n` +
           `**⚔️ Guerre:** declare, attack, defend, peace\n` +
           `**🛡️ Armée:** recruit, daily, stats\n` +
           `**📊 Info:** ranking, wars, help\n\n` +
           `Utilise \`/clan help\` pour le guide complet !`;
  }
}

// Export pour utilisation dans le bot
module.exports = {
  name: 'clan',
  description: 'Système complet de gestion de clans avec guerres et stratégie',
  usage: '/clan [commande]',
  
  async execute(message, args) {
    try {
      const clanSystem = new ClanSystem();
      const userId = message.author?.id || message.from || 'unknown';
      const userPseudo = message.author?.username || message.pushname || 'Anonyme';
      
      const response = await clanSystem.processCommand(userId, userPseudo, args);
      
      // Adaptation pour différentes plateformes
      if (message.reply) {
        await message.reply(response);
      } else if (message.send) {
        await message.send(response);
      } else {
        console.log(response);
        return response;
      }
      
    } catch (error) {
      console.error('Erreur dans la commande clan:', error);
      const errorMsg = "❌ **Erreur technique !** Réessaye dans quelques instants.";
      
      if (message.reply) {
        await message.reply(errorMsg);
      } else if (message.send) {
        await message.send(errorMsg);
      } else {
        return errorMsg;
      }
    }
  },

  // Fonction utilitaire pour les tâches automatiques
  async runDailyTasks() {
    try {
      const clanSystem = new ClanSystem();
      const clans = clanSystem.getClans();
      let updated = false;

      for (const [clanName, clan] of Object.entries(clans)) {
        const now = Date.now();
        const lastReward = clan.lastDailyReward || 0;
        const oneDayMs = CONFIG.COOLDOWNS.daily_reward;

        // Attribution automatique des revenus quotidiens (si pas réclamés manuellement)
        if (now - lastReward >= oneDayMs * 2) { // 48h sans réclamation
          const rank = clanSystem.getRank(clan.points);
          const baseReward = rank.dailyGold;
          const memberBonus = Math.floor(Object.keys(clan.membres).length / 3) * 25;
          const territoryBonus = (clan.territoires || 1) * 20;
          const totalReward = Math.floor((baseReward + memberBonus + territoryBonus) * 0.5); // 50% du montant normal
          
          clan.or += totalReward;
          clan.lastDailyReward = now;
          updated = true;

          console.log(`Revenu automatique attribué au clan ${clanName}: +${totalReward} or`);
        }

        // Dégradation progressive des bonus défensifs
        if (clan.defenseBonuses) {
          for (const [bonus, level] of Object.entries(clan.defenseBonuses)) {
            if (level > 0 && Math.random() < 0.1) { // 10% de chance de dégradation par jour
              clan.defenseBonuses[bonus] = Math.max(0, level - 1);
              updated = true;
            }
          }
        }
      }

      if (updated) {
        clanSystem.saveClans(clans);
      }

      // Nettoyer les guerres expirées (plus de 7 jours)
      const wars = clanSystem.getWars();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      let warsUpdated = false;

      for (const [warId, war] of Object.entries(wars)) {
        if (now - war.startTime > sevenDaysMs) {
          delete wars[warId];
          warsUpdated = true;
          
          // Remettre les clans en statut neutre
          if (clans[war.attacker]) clans[war.attacker].statut = "neutre";
          if (clans[war.defender]) clans[war.defender].statut = "neutre";
          
          console.log(`Guerre expirée supprimée: ${war.attacker} vs ${war.defender}`);
        }
      }

      if (warsUpdated) {
        clanSystem.saveWars(wars);
        if (updated) clanSystem.saveClans(clans);
      }

      // Nettoyer les demandes de rejoindre expirées (plus de 3 jours)
      const requests = clanSystem.getRequests();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      let requestsUpdated = false;

      for (const [requestId, request] of Object.entries(requests)) {
        if (now - request.timestamp > threeDaysMs) {
          delete requests[requestId];
          requestsUpdated = true;
        }
      }

      if (requestsUpdated) {
        clanSystem.saveRequests(requests);
      }

      // Nettoyer les timers expirés (plus de 30 jours)
      const timers = clanSystem.getTimers();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      let timersUpdated = false;

      for (const [userId, userTimers] of Object.entries(timers)) {
        for (const [action, timestamp] of Object.entries(userTimers)) {
          if (now - timestamp > thirtyDaysMs) {
            delete timers[userId][action];
            timersUpdated = true;
          }
        }
        
        // Supprimer les utilisateurs sans timers
        if (Object.keys(timers[userId]).length === 0) {
          delete timers[userId];
          timersUpdated = true;
        }
      }

      if (timersUpdated) {
        clanSystem.saveTimers(timers);
      }

    } catch (error) {
      console.error('Erreur lors des tâches quotidiennes du clan:', error);
    }
  },

  // Fonction pour générer des événements aléatoires
  async generateRandomEvent() {
    try {
      const clanSystem = new ClanSystem();
      const clans = clanSystem.getClans();
      const clanNames = Object.keys(clans);
      
      if (clanNames.length === 0) return null;

      const events = [
        {
          type: 'treasure',
          name: 'Trésor Ancien',
          description: 'découvre un trésor ancien dans les ruines',
          emoji: '💰',
          rarity: 'rare',
          effect: (clan) => {
            const bonus = Math.floor(Math.random() * 800) + 300;
            clan.or += bonus;
            return `💰 +${bonus.toLocaleString()} or trouvé !`;
          }
        },
        {
          type: 'plague',
          name: 'Maladie Mystérieuse',
          description: 'est frappé par une mystérieuse épidémie',
          emoji: '💀',
          rarity: 'rare',
          effect: (clan) => {
            let totalLost = 0;
            for (const member of Object.values(clan.membres)) {
              for (const [type, count] of Object.entries(member.unites || {})) {
                const lost = Math.floor(count * (0.05 + Math.random() * 0.1)); // 5-15% de pertes
                member.unites[type] = Math.max(0, count - lost);
                totalLost += lost;
              }
            }
            return `💀 ${totalLost} unités perdues à cause de la maladie`;
          }
        },
        {
          type: 'blessing',
          name: 'Bénédiction Divine',
          description: 'reçoit la bénédiction des anciens dieux',
          emoji: '✨',
          rarity: 'épique',
          effect: (clan) => {
            const pointsBonus = Math.floor(Math.random() * 150) + 75;
            const goldBonus = Math.floor(Math.random() * 500) + 200;
            clan.points += pointsBonus;
            clan.or += goldBonus;
            return `✨ +${pointsBonus} points et +${goldBonus.toLocaleString()} or bénis !`;
          }
        },
        {
          type: 'recruitment',
          name: 'Vague de Recrutement',
          description: 'attire de nouveaux guerriers courageux',
          emoji: '⚔️',
          rarity: 'commun',
          effect: (clan) => {
            const members = Object.values(clan.membres);
            if (members.length === 0) return 'Aucun membre pour recevoir les recrues.';
            
            const randomMember = members[Math.floor(Math.random() * members.length)];
            const unitTypes = ['fantassin', 'archer'];
            const randomType = unitTypes[Math.floor(Math.random() * unitTypes.length)];
            const count = Math.floor(Math.random() * 5) + 2;
            
            if (!randomMember.unites[randomType]) randomMember.unites[randomType] = 0;
            randomMember.unites[randomType] += count;
            
            return `⚔️ +${count} ${randomType}(s) ont rejoint ${randomMember.pseudo} !`;
          }
        },
        {
          type: 'merchant',
          name: 'Marchand Généreux',
          description: 'reçoit la visite d\'un marchand généreux',
          emoji: '🏪',
          rarity: 'commun',
          effect: (clan) => {
            const discount = Math.floor(Math.random() * 30) + 20; // 20-50% de réduction
            // Pour simplifier, on donne de l'or équivalent à la réduction
            const bonus = Math.floor(Math.random() * 300) + 150;
            clan.or += bonus;
            return `🏪 Commerce florissant ! +${bonus.toLocaleString()} or gagné`;
          }
        },
        {
          type: 'territory',
          name: 'Expansion Territoriale',
          description: 'découvre et revendique de nouvelles terres',
          emoji: '🏴',
          rarity: 'épique',
          effect: (clan) => {
            if (Math.random() < 0.3) { // 30% de chance
              clan.territoires = (clan.territoires || 1) + 1;
              const bonus = 200 + (clan.territoires * 50);
              clan.or += bonus;
              return `🏴 +1 territoire conquis ! +${bonus.toLocaleString()} or de revenus`;
            }
            return `🗺️ Exploration sans succès cette fois...`;
          }
        },
        {
          type: 'festival',
          name: 'Festival du Clan',
          description: 'organise un grand festival qui booste le moral',
          emoji: '🎉',
          rarity: 'commun',
          effect: (clan) => {
            const pointsBonus = Object.keys(clan.membres).length * 10;
            clan.points += pointsBonus;
            
            // Petit bonus d'unités pour tous
            for (const member of Object.values(clan.membres)) {
              if (!member.unites.fantassin) member.unites.fantassin = 0;
              member.unites.fantassin += 1;
            }
            
            return `🎉 Festival réussi ! +${pointsBonus} points et +1 fantassin par membre`;
          }
        },
        {
          type: 'sabotage',
          name: 'Sabotage Ennemi',
          description: 'subit un sabotage de ses défenses',
          emoji: '🔥',
          rarity: 'rare',
          effect: (clan) => {
            let totalDamage = 0;
            
            // Réduire les bonus défensifs
            if (clan.defenseBonuses) {
              for (const [bonus, level] of Object.entries(clan.defenseBonuses)) {
                const damage = Math.floor(level * 0.3);
                clan.defenseBonuses[bonus] = Math.max(0, level - damage);
                totalDamage += damage;
              }
            }
            
            // Perte d'or
            const goldLoss = Math.floor(clan.or * 0.05);
            clan.or = Math.max(0, clan.or - goldLoss);
            
            return `🔥 Sabotage ! -${totalDamage} niveaux de défense, -${goldLoss.toLocaleString()} or`;
          }
        }
      ];

      // Choisir un clan aléatoirement
      const randomClan = clanNames[Math.floor(Math.random() * clanNames.length)];
      
      // Choisir un événement basé sur la rareté
      const rarityWeights = { commun: 60, rare: 30, épique: 10 };
      const totalWeight = Object.values(rarityWeights).reduce((a, b) => a + b, 0);
      let randomWeight = Math.random() * totalWeight;
      
      let selectedRarity = 'commun';
      for (const [rarity, weight] of Object.entries(rarityWeights)) {
        randomWeight -= weight;
        if (randomWeight <= 0) {
          selectedRarity = rarity;
          break;
        }
      }
      
      const availableEvents = events.filter(e => e.rarity === selectedRarity);
      const randomEvent = availableEvents[Math.floor(Math.random() * availableEvents.length)];
      
      const clan = clans[randomClan];
      const effectResult = randomEvent.effect(clan);
      
      clanSystem.saveClans(clans);

      // Enregistrer l'événement
      const eventsLog = clanSystem.getEvents();
      const eventId = `${Date.now()}_${randomClan}`;
      
      eventsLog[eventId] = {
        clanName: randomClan,
        eventType: randomEvent.type,
        eventName: randomEvent.name,
        timestamp: Date.now(),
        effect: effectResult
      };
      
      clanSystem.saveEvents(eventsLog);

      return {
        clanName: randomClan,
        blason: clan.blason,
        rarity: selectedRarity,
        rarityEmoji: selectedRarity === 'épique' ? '🌟' : selectedRarity === 'rare' ? '💎' : '📜',
        message: `${randomEvent.emoji} **ÉVÉNEMENT ${selectedRarity.toUpperCase()} !**\n\n` +
                 `${clan.blason} **${randomClan}** ${randomEvent.description} !\n\n` +
                 `${effectResult}\n\n` +
                 `📅 ${new Date().toLocaleString()}`
      };

    } catch (error) {
      console.error('Erreur lors de la génération d\'événement:', error);
      return null;
    }
  },

  // Fonction pour obtenir les statistiques globales
  getGlobalStats() {
    try {
      const clanSystem = new ClanSystem();
      const clans = clanSystem.getClans();
      const wars = clanSystem.getWars();
      const events = clanSystem.getEvents();

      const totalClans = Object.keys(clans).length;
      const totalMembers = Object.values(clans).reduce((sum, clan) => 
        sum + Object.keys(clan.membres).length, 0);
      const activeWars = Object.keys(wars).length;
      const totalGold = Object.values(clans).reduce((sum, clan) => sum + clan.or, 0);
      const totalPoints = Object.values(clans).reduce((sum, clan) => sum + clan.points, 0);
      const totalTerritories = Object.values(clans).reduce((sum, clan) => sum + (clan.territoires || 1), 0);
      const totalEvents = Object.keys(events).length;

      // Calcul des unités totales
      const totalUnits = Object.values(clans).reduce((total, clan) => {
        const clanUnits = Object.values(clan.membres).reduce((clanTotal, member) => {
          for (const [type, count] of Object.entries(member.unites || {})) {
            clanTotal[type] = (clanTotal[type] || 0) + count;
          }
          return clanTotal;
        }, {});
        
        for (const [type, count] of Object.entries(clanUnits)) {
          total[type] = (total[type] || 0) + count;
        }
        return total;
      }, {});

      const topClan = Object.entries(clans)
        .sort(([,a], [,b]) => b.points - a.points)[0];

      const mostActiveDay = Object.values(events)
        .reduce((acc, event) => {
          const day = new Date(event.timestamp).toDateString();
          acc[day] = (acc[day] || 0) + 1;
          return acc;
        }, {});
      
      const peakActivity = Object.entries(mostActiveDay)
        .sort(([,a], [,b]) => b - a)[0];

      return {
        totalClans,
        totalMembers,
        activeWars,
        totalGold,
        totalPoints,
        totalTerritories,
        totalEvents,
        totalUnits,
        averageMembersPerClan: totalClans > 0 ? Math.round(totalMembers / totalClans * 10) / 10 : 0,
        topClan: topClan ? { 
          name: topClan[0], 
          points: topClan[1].points, 
          blason: topClan[1].blason,
          members: Object.keys(topClan[1].membres).length
        } : null,
        peakActivity: peakActivity ? {
          date: peakActivity[0],
          events: peakActivity[1]
        } : null
      };

    } catch (error) {
      console.error('Erreur lors du calcul des statistiques globales:', error);
      return null;
    }
  },

  // Fonction pour obtenir l'historique des événements d'un clan
  getClanEventHistory(clanName, limit = 10) {
    try {
      const clanSystem = new ClanSystem();
      const events = clanSystem.getEvents();
      
      const clanEvents = Object.values(events)
        .filter(event => event.clanName === clanName)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      return clanEvents;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique:', error);
      return [];
    }
  },

  // Fonction pour nettoyer les données (maintenance)
  async cleanupData() {
    try {
      const clanSystem = new ClanSystem();
      
      // Supprimer les clans vides (sans membres)
      const clans = clanSystem.getClans();
      let clansUpdated = false;
      
      for (const [clanName, clan] of Object.entries(clans)) {
        if (!clan.membres || Object.keys(clan.membres).length === 0) {
          delete clans[clanName];
          clansUpdated = true;
          console.log(`Clan vide supprimé: ${clanName}`);
        }
      }
      
      if (clansUpdated) {
        clanSystem.saveClans(clans);
      }

      // Nettoyer les événements anciens (plus de 30 jours)
      const events = clanSystem.getEvents();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      let eventsUpdated = false;
      
      for (const [eventId, event] of Object.entries(events)) {
        if (Date.now() - event.timestamp > thirtyDaysMs) {
          delete events[eventId];
          eventsUpdated = true;
        }
      }
      
      if (eventsUpdated) {
        clanSystem.saveEvents(events);
      }

      console.log('Nettoyage des données terminé');
      return true;
    } catch (error) {
      console.error('Erreur lors du nettoyage des données:', error);
      return false;
    }
  },

  // Configuration et classe exportées pour accès externe
  CONFIG,
  ClanSystem
};
