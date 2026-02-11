/**
 * Centralized inline keyboard definitions for all bot menus.
 */

function mainMenu(isAdmin) {
  const keyboard = [
    [{ text: '🌐 Manage Domains', callback_data: 'domains_list' }],
    [{ text: '➕ Add New Domain', callback_data: 'domain_add' }],
  ];

  if (isAdmin) {
    keyboard.push(
      [{ text: '⚙️ Admin Panel', callback_data: 'admin_panel' }]
    );
  }

  keyboard.push(
    [{ text: '📖 Help', callback_data: 'help' }]
  );

  return { reply_markup: { inline_keyboard: keyboard } };
}

function cancelButton() {
  return { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }]] } };
}

function backToMain() {
  return { reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]] } };
}

function vpsSelectList(vpsList) {
  const keyboard = vpsList.map((vps, i) => [{
    text: `${i + 1}️⃣ ${vps.name} (${vps.ip})`,
    callback_data: `vps_select_${vps.id}`,
  }]);
  keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);
  return { reply_markup: { inline_keyboard: keyboard } };
}

function nsConfigured() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ I've Updated Nameservers", callback_data: 'ns_verify' }],
        [{ text: '❌ Cancel Setup', callback_data: 'cancel' }],
      ],
    },
  };
}

function afterDomainDeploy(domainId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Add Subdomain', callback_data: `subdomain_add_${domainId}` }],
        [{ text: '📋 Manage Domain', callback_data: `domain_manage_${domainId}` }],
        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
      ],
    },
  };
}

function domainManage(domainId, accessLevel) {
  const keyboard = [];

  if (accessLevel !== 'view') {
    keyboard.push([{ text: '➕ Add Subdomain', callback_data: `subdomain_add_${domainId}` }]);
    keyboard.push([{ text: '🔄 Update Site Files', callback_data: `domain_update_${domainId}` }]);
    keyboard.push([{ text: '🔐 Renew SSL Certificate', callback_data: `domain_renew_ssl_${domainId}` }]);
  }

  keyboard.push([{ text: '📊 View Subdomains', callback_data: `domain_subs_${domainId}` }]);

  if (accessLevel === 'owner') {
    keyboard.push([{ text: '👥 Share Domain', callback_data: `domain_share_${domainId}` }]);
    keyboard.push([{ text: '🗑️ Delete Domain', callback_data: `domain_delete_${domainId}` }]);
  }

  keyboard.push([{ text: '⬅️ Back to List', callback_data: 'domains_list' }]);

  return { reply_markup: { inline_keyboard: keyboard } };
}

function domainShareMenu(domainId, sharedUsers) {
  const keyboard = [];

  for (const su of sharedUsers) {
    const name = su.username ? `@${su.username}` : (su.first_name || su.user_telegram_id);
    const levelIcon = su.access_level === 'edit' ? '✏️' : '👁️';
    keyboard.push([
      { text: `${levelIcon} ${name}`, callback_data: `share_manage_${domainId}_${su.user_telegram_id}` },
    ]);
  }

  keyboard.push([{ text: '➕ Share with Member', callback_data: `share_add_${domainId}` }]);
  keyboard.push([{ text: '⬅️ Back to Domain', callback_data: `domain_manage_${domainId}` }]);

  return { reply_markup: { inline_keyboard: keyboard } };
}

function shareAccessLevel(domainId, targetTelegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👁️ View Only', callback_data: `share_level_view_${domainId}_${targetTelegramId}` }],
        [{ text: '✏️ Edit (Full Access)', callback_data: `share_level_edit_${domainId}_${targetTelegramId}` }],
        [{ text: '❌ Cancel', callback_data: `domain_share_${domainId}` }],
      ],
    },
  };
}

function shareManageUser(domainId, targetTelegramId, currentLevel) {
  const otherLevel = currentLevel === 'edit' ? 'view' : 'edit';
  const otherLabel = currentLevel === 'edit' ? '👁️ Change to View Only' : '✏️ Change to Edit';

  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: otherLabel, callback_data: `share_level_${otherLevel}_${domainId}_${targetTelegramId}` }],
        [{ text: '🗑️ Revoke Access', callback_data: `share_revoke_${domainId}_${targetTelegramId}` }],
        [{ text: '⬅️ Back', callback_data: `domain_share_${domainId}` }],
      ],
    },
  };
}

function subdomainManage(subdomainId, domainId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Update Site Files', callback_data: `subdomain_update_${subdomainId}` }],
        [{ text: '🔐 Renew SSL Certificate', callback_data: `subdomain_renew_ssl_${subdomainId}` }],
        [{ text: '🗑️ Delete Subdomain', callback_data: `subdomain_delete_${subdomainId}` }],
        [{ text: '⬅️ Back to Domain', callback_data: `domain_manage_${domainId}` }],
      ],
    },
  };
}

function confirmDelete(type, id) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚠️ Yes, DELETE permanently', callback_data: `confirm_delete_${type}_${id}` }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }],
      ],
    },
  };
}

function domainListItem(domain) {
  return [
    [{ text: `📋 Manage ${domain.domain}`, callback_data: `domain_manage_${domain.id}` }],
    [{ text: `🗑️ Delete`, callback_data: `domain_delete_${domain.id}` }],
  ];
}

// Admin panel keyboards

function adminPanel() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🖥️ VPS Management', callback_data: 'admin_vps' }],
        [{ text: '👥 Team Management', callback_data: 'admin_team' }],
        [{ text: '☁️ Cloudflare Settings', callback_data: 'admin_cloudflare' }],
        [{ text: '📊 Statistics', callback_data: 'admin_stats' }],
        [{ text: '📜 Activity Logs', callback_data: 'admin_logs' }],
        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
      ],
    },
  };
}

function adminVPS() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Add VPS', callback_data: 'vps_add' }],
        [{ text: '📋 List VPS', callback_data: 'vps_list' }],
        [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
      ],
    },
  };
}

function adminTeam() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Add Team Member', callback_data: 'team_add' }],
        [{ text: '📋 List Team', callback_data: 'team_list' }],
        [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
      ],
    },
  };
}

function vpsAuthType() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 Password (Recommended)', callback_data: 'vps_auth_password' }],
        [{ text: '🔐 SSH Key', callback_data: 'vps_auth_key' }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }],
      ],
    },
  };
}

function vpsInstallDNS() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Yes, Install PowerDNS', callback_data: 'vps_install_dns' }],
        [{ text: '❌ Skip for now', callback_data: 'vps_skip_dns' }],
      ],
    },
  };
}

function afterVPSSetup(vpsId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 Add First Domain', callback_data: 'domain_add' }],
        [{ text: '⚙️ VPS Settings', callback_data: `vps_manage_${vpsId}` }],
        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
      ],
    },
  };
}

function teamRoleSelect(telegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👤 Assign Member Role', callback_data: `team_role_member_${telegramId}` }],
        [{ text: '👑 Assign Admin Role', callback_data: `team_role_admin_${telegramId}` }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }],
      ],
    },
  };
}

function teamMemberActions(telegramId, currentRole) {
  const buttons = [];

  if (currentRole === 'member') {
    buttons.push([{ text: '👑 Promote to Admin', callback_data: `team_promote_${telegramId}` }]);
  } else {
    buttons.push([{ text: '👤 Demote to Member', callback_data: `team_demote_${telegramId}` }]);
  }

  buttons.push([{ text: '🗑️ Remove Member', callback_data: `team_remove_${telegramId}` }]);
  buttons.push([{ text: '⬅️ Back', callback_data: 'team_list' }]);

  return { reply_markup: { inline_keyboard: buttons } };
}

function vpsManage(vpsId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 View Domains', callback_data: `vps_domains_${vpsId}` }],
        [{ text: '🗑️ Remove VPS', callback_data: `vps_delete_${vpsId}` }],
        [{ text: '⬅️ Back', callback_data: 'admin_vps' }],
      ],
    },
  };
}

module.exports = {
  mainMenu,
  cancelButton,
  backToMain,
  vpsSelectList,
  nsConfigured,
  afterDomainDeploy,
  domainManage,
  domainShareMenu,
  shareAccessLevel,
  shareManageUser,
  subdomainManage,
  confirmDelete,
  domainListItem,
  adminPanel,
  adminVPS,
  adminTeam,
  vpsAuthType,
  vpsInstallDNS,
  afterVPSSetup,
  teamRoleSelect,
  teamMemberActions,
  vpsManage,
};
