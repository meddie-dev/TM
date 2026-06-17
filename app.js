// Use the existing supabase client from auth.js
let currentUser = null;
let currentUserProfile = null;
let editingTaskId = null;
let viewingTaskId = null;
let editingRemarkId = null;

// ============================================
// INITIALIZATION
// ============================================

async function init() {
    try {
        const { data: { user }, error: userError } = await window.supabaseClient.auth.getUser();
        
        if (userError || !user) {
            console.error('Auth error:', userError);
            window.location.href = 'login.html';
            return;
        }
        
        currentUser = user;
        console.log('User logged in:', currentUser.email);
        
        await loadUserProfile();
        await loadUsersForAssignment();
        await loadTasks();
        await updateDashboardStats();
        
        if (currentUserProfile?.role === 'admin') {
            document.getElementById('adminPanel').style.display = 'block';
            document.getElementById('assigneeHeader').style.display = 'table-cell';
            document.getElementById('assigneeHeaderCompleted').style.display = 'table-cell';
            await loadAllUsers();
        } else {
            document.getElementById('assigneeHeader').style.display = 'none';
            document.getElementById('assigneeHeaderCompleted').style.display = 'none';
        }
    } catch (error) {
        console.error('Init error:', error);
    }
}

// Load user profile
async function loadUserProfile() {
    try {
        const { data, error } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id);
        
        if (error) {
            console.error('Error loading profile:', error);
            return;
        }
        
        if (data && data.length > 0) {
            currentUserProfile = data[0];
            
            // Update user name in header - check if element exists
            const userNameHeader = document.getElementById('userNameHeader');
            if (userNameHeader) {
                userNameHeader.textContent = currentUserProfile.full_name || currentUserProfile.email;
            }
            
            const userEmail = document.getElementById('userEmail');
            if (userEmail) {
                userEmail.textContent = currentUserProfile.email;
            }
            
            // Update any other user name elements
            document.querySelectorAll('#userName').forEach(el => {
                if (el) el.textContent = currentUserProfile.full_name || currentUserProfile.email;
            });
            
            // Update user role if it exists
            const userRole = document.getElementById('userRole');
            if (userRole) {
                userRole.textContent = (currentUserProfile.role || 'user').toUpperCase();
                userRole.className = `role-badge role-${currentUserProfile.role || 'user'}`;
            }
        } else {
            console.log('Profile not found, creating...');
            const { error: insertError } = await window.supabaseClient
                .from('profiles')
                .insert({
                    id: currentUser.id,
                    email: currentUser.email,
                    full_name: currentUser.user_metadata?.full_name || currentUser.email,
                    role: 'user'
                });
            
            if (insertError) {
                console.error('Error creating profile:', insertError);
            } else {
                await loadUserProfile();
            }
        }
    } catch (error) {
        console.error('Error in loadUserProfile:', error);
    }
}

// ============================================
// TASK MANAGEMENT
// ============================================

// Load tasks
async function loadTasks() {
    try {
        // First, get all tasks without the join to avoid foreign key issues
        let query = window.supabaseClient
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
        
        // If not admin, only show tasks created by or assigned to user
        if (currentUserProfile?.role !== 'admin') {
            query = query.or(`created_by.eq.${currentUser.id},assigned_to.eq.${currentUser.id}`);
        }
        
        const { data: tasksData, error: tasksError } = await query;
        
        if (tasksError) {
            console.error('Error loading tasks:', tasksError);
            return;
        }
        
        // Get all unique user IDs from tasks
        const userIds = new Set();
        tasksData.forEach(task => {
            if (task.assigned_to) userIds.add(task.assigned_to);
            if (task.created_by) userIds.add(task.created_by);
        });
        
        // Fetch user profiles for these IDs
        let profilesMap = {};
        if (userIds.size > 0) {
            const { data: profilesData, error: profilesError } = await window.supabaseClient
                .from('profiles')
                .select('id, full_name, email')
                .in('id', Array.from(userIds));
            
            if (!profilesError && profilesData) {
                profilesData.forEach(profile => {
                    profilesMap[profile.id] = profile;
                });
            }
        }
        
        // Enrich tasks with assignee names
        const processedTasks = tasksData.map(task => {
            if (task.assigned_to && profilesMap[task.assigned_to]) {
                task.assigned_to_name = profilesMap[task.assigned_to].full_name || profilesMap[task.assigned_to].email;
            } else if (task.assigned_to) {
                task.assigned_to_name = task.assigned_to; // fallback to ID
            }
            return task;
        });
        
        // Separate active and completed tasks
        const activeTasks = processedTasks.filter(task => task.status !== 'completed');
        const completedTasks = processedTasks.filter(task => task.status === 'completed');
        
        displayTasks(activeTasks, 'activeTasksTableBody');
        displayTasks(completedTasks, 'completedTasksTableBody', true);
        updateDashboardStats(processedTasks);
    } catch (error) {
        console.error('Error in loadTasks:', error);
    }
}

// Display tasks in table
function displayTasks(tasks, tableBodyId, isCompleted = false) {
    const tbody = document.getElementById(tableBodyId);
    
    if (!tbody) {
        console.error('Table body not found:', tableBodyId);
        return;
    }
    
    if (!tasks || tasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No ${isCompleted ? 'completed' : 'active'} tasks found.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = '';
    
    tasks.forEach(task => {
        const row = document.createElement('tr');
        
        const isAdmin = currentUserProfile?.role === 'admin';
        const canEdit = isAdmin || currentUser?.id === task.created_by;
        
        const statusLabels = {
            pending: 'Pending',
            in_progress: 'In Progress',
            completed: 'Completed',
            cancelled: 'Cancelled'
        };
        
        // Only show status dropdown for active tasks
        let statusHtml;
        if (isCompleted) {
            statusHtml = `<span class="status-badge status-${task.status}">${statusLabels[task.status] || task.status}</span>`;
        } else {
            const statusOptions = ['pending', 'in_progress', 'completed', 'cancelled'];
            statusHtml = `
                <select class="status-badge status-${task.status}" onchange="updateTaskStatus(${task.id}, this.value)" ${!canEdit ? 'disabled' : ''}>
                    ${statusOptions.map(s => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${statusLabels[s]}</option>`).join('')}
                </select>
            `;
        }
        
        const assigneeName = task.assigned_to_name || task.assigned_to || 'Unassigned';
        
        row.innerHTML = `
            <td><strong>${escapeHtml(task.ticket_number || 'N/A')}</strong></td>
            <td><strong>${escapeHtml(task.title)}</strong></td>
            <td><span class="priority-badge priority-${task.priority}">${(task.priority || 'medium').toUpperCase()}</span></td>
            <td>${statusHtml}</td>
            <td ${!isAdmin ? 'style="display:none"' : ''}>${escapeHtml(assigneeName)}</td>
            <td>${task.deadline ? new Date(task.deadline).toLocaleDateString() : 'No deadline'}</td>
            <td>
                <button class="action-btn view" onclick="viewTaskDetails(${task.id})"><i class="bi bi-eye"></i></button>
                ${canEdit ? `
                    <button class="action-btn edit" onclick="editTask(${task.id})"><i class="bi bi-pencil"></i></button>
                    <button class="action-btn delete" onclick="deleteTask(${task.id})"><i class="bi bi-trash3"></i></button>
                ` : ''}
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Update dashboard stats
// Update dashboard stats
async function updateDashboardStats(tasks) {
    if (!tasks) {
        try {
            const { data } = await window.supabaseClient
                .from('tasks')
                .select('*');
            tasks = data || [];
        } catch (error) {
            console.error('Error loading tasks for stats:', error);
            return;
        }
    }
    
    // Filter out completed tasks for priority counts
    const activeTasks = tasks.filter(t => t.status !== 'completed');
    
    // Status counts (all tasks)
    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const cancelled = tasks.filter(t => t.status === 'cancelled').length;
    
    const pendingCount = document.getElementById('pendingCount');
    const completedCount = document.getElementById('completedCount');
    const cancelledCount = document.getElementById('cancelledCount');
    
    if (pendingCount) pendingCount.textContent = pending;
    if (completedCount) completedCount.textContent = completed;
    if (cancelledCount) cancelledCount.textContent = cancelled;
    
    // Priority counts (ONLY active tasks - not completed)
    const high = activeTasks.filter(t => t.priority === 'high').length;
    const medium = activeTasks.filter(t => t.priority === 'medium').length;
    const low = activeTasks.filter(t => t.priority === 'low').length;
    
    const highCount = document.getElementById('highCount');
    const mediumCount = document.getElementById('mediumCount');
    const lowCount = document.getElementById('lowCount');
    
    if (highCount) highCount.textContent = high;
    if (mediumCount) mediumCount.textContent = medium;
    if (lowCount) lowCount.textContent = low;
}

// Update task status
window.updateTaskStatus = async function(taskId, status) {
    try {
        const { error } = await window.supabaseClient
            .from('tasks')
            .update({ status: status, updated_at: new Date() })
            .eq('id', taskId);
        
        if (error) {
            alert('Error updating status: ' + error.message);
        } else {
            await loadTasks();
        }
    } catch (error) {
        alert('Error updating status: ' + error.message);
    }
};

// Delete task
window.deleteTask = async function(taskId) {
    if (confirm('Are you sure you want to delete this task?')) {
        try {
            // Delete related remarks first
            await window.supabaseClient
                .from('task_remarks')
                .delete()
                .eq('task_id', taskId);
            
            const { error } = await window.supabaseClient
                .from('tasks')
                .delete()
                .eq('id', taskId);
            
            if (error) {
                alert('Error deleting task: ' + error.message);
            } else {
                await loadTasks();
            }
        } catch (error) {
            alert('Error deleting task: ' + error.message);
        }
    }
};

// Edit task - open modal with task data
window.editTask = async function(taskId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .single();
        
        if (error) {
            alert('Error loading task details: ' + error.message);
            return;
        }
        
        editingTaskId = taskId;
        
        // Get elements with null checks
        const modalTitle = document.getElementById('modalTitle');
        const taskTitle = document.getElementById('modalTaskTitle');
        const taskDescription = document.getElementById('modalTaskDescription');
        const taskPriority = document.getElementById('modalTaskPriority');
        const taskStatus = document.getElementById('modalTaskStatus');
        const taskDeadline = document.getElementById('modalTaskDeadline');
        const taskTicketNumber = document.getElementById('modalTicketNumber');
        const submitBtn = document.querySelector('.modal .submit-btn');
        
        if (modalTitle) modalTitle.textContent = 'Edit Task';
        if (taskTitle) taskTitle.value = data.title || '';
        if (taskDescription) taskDescription.value = data.description || '';
        if (taskPriority) taskPriority.value = data.priority || 'medium';
        if (taskStatus) taskStatus.value = data.status || 'pending';
        if (taskDeadline) taskDeadline.value = data.deadline || '';
        if (taskTicketNumber) taskTicketNumber.value = data.ticket_number || '';
        if (submitBtn) submitBtn.textContent = 'Update Task';
        
        // Set assignee if admin
        if (currentUserProfile?.role === 'admin') {
            const assigneeSelect = document.getElementById('modalTaskAssignTo');
            if (assigneeSelect) {
                assigneeSelect.value = data.assigned_to || '';
            }
        }
        
        openModal();
    } catch (error) {
        console.error('Error in editTask:', error);
        alert('Error loading task details: ' + error.message);
    }
};

// View task details
window.viewTaskDetails = async function(taskId) {
    viewingTaskId = taskId;
    
    try {
        // Load task details
        const { data: taskData, error: taskError } = await window.supabaseClient
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .single();
        
        if (taskError) {
            alert('Error loading task details');
            return;
        }
        
        // Get assignee name
        let assigneeName = 'Unassigned';
        if (taskData.assigned_to) {
            const { data: userData } = await window.supabaseClient
                .from('profiles')
                .select('full_name, email')
                .eq('id', taskData.assigned_to)
                .single();
            if (userData) {
                assigneeName = userData.full_name || userData.email;
            }
        }
        
        // Load remarks with user info
        const { data: remarksData, error: remarksError } = await window.supabaseClient
            .from('task_remarks')
            .select('*')
            .eq('task_id', taskId)
            .order('created_at', { ascending: false });
        
        if (remarksError) {
            console.error('Error loading remarks:', remarksError);
        }
        
        // Get user names for remarks
        const userIds = new Set();
        if (remarksData) {
            remarksData.forEach(remark => {
                if (remark.user_id) userIds.add(remark.user_id);
            });
        }
        
        let userMap = {};
        if (userIds.size > 0) {
            const { data: userData } = await window.supabaseClient
                .from('profiles')
                .select('id, full_name, email')
                .in('id', Array.from(userIds));
            if (userData) {
                userData.forEach(user => {
                    userMap[user.id] = user;
                });
            }
        }
        
        // Enrich remarks with user names
        const enrichedRemarks = (remarksData || []).map(remark => {
            if (remark.user_id && userMap[remark.user_id]) {
                remark.user_name = userMap[remark.user_id].full_name || userMap[remark.user_id].email;
            } else {
                remark.user_name = remark.user_id || 'Unknown User';
            }
            return remark;
        });
        
        // Populate detail modal
        const detailTicketNumber = document.getElementById('detailTicketNumber');
        const detailTitle = document.getElementById('detailTitle');
        const detailDescription = document.getElementById('detailDescription');
        const detailPriority = document.getElementById('detailPriority');
        const detailStatus = document.getElementById('detailStatus');
        const detailAssignee = document.getElementById('detailAssignee');
        const detailDeadline = document.getElementById('detailDeadline');
        
        if (detailTicketNumber) detailTicketNumber.textContent = taskData.ticket_number || 'N/A';
        if (detailTitle) detailTitle.textContent = taskData.title;
        if (detailDescription) detailDescription.textContent = taskData.description || 'No description';
        if (detailPriority) detailPriority.textContent = (taskData.priority || 'medium').toUpperCase();
        if (detailStatus) detailStatus.textContent = (taskData.status || 'pending').toUpperCase();
        if (detailAssignee) detailAssignee.textContent = assigneeName;
        if (detailDeadline) detailDeadline.textContent = taskData.deadline ? new Date(taskData.deadline).toLocaleDateString() : 'No deadline';
        
        // Display remarks
        displayRemarks(enrichedRemarks);
        
        // Clear remark input and reset editing state
        const remarkInput = document.getElementById('remarkInput');
        if (remarkInput) remarkInput.value = '';
        editingRemarkId = null;
        
        const submitBtn = document.getElementById('submitRemarkBtn');
        if (submitBtn) submitBtn.textContent = 'Add Remark';
        
        const cancelBtn = document.getElementById('cancelRemarkBtn');
        if (cancelBtn) cancelBtn.classList.remove('show');
        
        openDetailModal();
    } catch (error) {
        console.error('Error viewing task:', error);
        alert('Error loading task details');
    }
};

// Display remarks
function displayRemarks(remarks) {
    const remarksList = document.getElementById('remarksList');
    if (!remarksList) return;
    
    remarksList.innerHTML = '';
    
    if (remarks && remarks.length > 0) {
        remarks.forEach(remark => {
            const div = document.createElement('div');
            div.className = 'remark-item';
            const userName = remark.user_name || 'Unknown User';
            const isOwner = currentUser?.id === remark.user_id;
            
            div.innerHTML = `
                <div class="remark-header">
                    <div class="remark-user">${escapeHtml(userName)}</div>
                    <div class="remark-actions">
                        ${isOwner ? `
                            <button class="action-btn edit" onclick="editRemark(${remark.id})" title="Edit"><i class="bi bi-pencil"></i></button>
                            <button class="action-btn delete" onclick="deleteRemark(${remark.id})" title="Delete"><i class="bi bi-trash3"></i></button>
                        ` : ''}
                    </div>
                </div>
                <div class="remark-text" id="remark-text-${remark.id}">${escapeHtml(remark.remark)}</div>
                <div class="remark-time">${new Date(remark.created_at).toLocaleString()}</div>
            `;
            remarksList.appendChild(div);
        });
    } else {
        remarksList.innerHTML = '<p style="color: #999; font-size: 13px;">No remarks yet.</p>';
    }
}

// Add/Update remark
window.submitRemark = async function() {
    if (!viewingTaskId) {
        alert('No task selected');
        return;
    }
    
    const remarkInput = document.getElementById('remarkInput');
    if (!remarkInput) return;
    
    const remarkText = remarkInput.value.trim();
    if (!remarkText) {
        alert('Please enter a remark');
        return;
    }
    
    try {
        let error;
        
        if (editingRemarkId) {
            // Update existing remark - removed updated_at since it doesn't exist
            const result = await window.supabaseClient
                .from('task_remarks')
                .update({ 
                    remark: remarkText
                })
                .eq('id', editingRemarkId)
                .eq('user_id', currentUser.id);
            
            error = result.error;
        } else {
            // Add new remark
            const result = await window.supabaseClient
                .from('task_remarks')
                .insert({
                    task_id: viewingTaskId,
                    user_id: currentUser.id,
                    remark: remarkText
                });
            error = result.error;
        }
        
        if (error) {
            alert('Error ' + (editingRemarkId ? 'updating' : 'adding') + ' remark: ' + error.message);
            return;
        }
        
        // Reload task details with new remark
        await viewTaskDetails(viewingTaskId);
    } catch (error) {
        alert('Error ' + (editingRemarkId ? 'updating' : 'adding') + ' remark: ' + error.message);
    }
};

// Edit remark
window.editRemark = function(remarkId) {
    const remarkText = document.getElementById(`remark-text-${remarkId}`);
    if (remarkText) {
        const remarkInput = document.getElementById('remarkInput');
        if (remarkInput) {
            remarkInput.value = remarkText.textContent;
            remarkInput.focus();
        }
        editingRemarkId = remarkId;
        
        const submitBtn = document.getElementById('submitRemarkBtn');
        if (submitBtn) submitBtn.textContent = 'Update Remark';
        
        const cancelBtn = document.getElementById('cancelRemarkBtn');
        if (cancelBtn) cancelBtn.classList.add('show');
    }
};

// Cancel remark edit
window.cancelRemarkEdit = function() {
    const remarkInput = document.getElementById('remarkInput');
    if (remarkInput) remarkInput.value = '';
    editingRemarkId = null;
    
    const submitBtn = document.getElementById('submitRemarkBtn');
    if (submitBtn) submitBtn.textContent = 'Add Remark';
    
    const cancelBtn = document.getElementById('cancelRemarkBtn');
    if (cancelBtn) cancelBtn.classList.remove('show');
};

// Delete remark
window.deleteRemark = async function(remarkId) {
    if (!confirm('Are you sure you want to delete this remark?')) {
        return;
    }
    
    try {
        const { error } = await window.supabaseClient
            .from('task_remarks')
            .delete()
            .eq('id', remarkId)
            .eq('user_id', currentUser.id);
        
        if (error) {
            alert('Error deleting remark: ' + error.message);
            return;
        }
        
        // Reload task details
        await viewTaskDetails(viewingTaskId);
    } catch (error) {
        alert('Error deleting remark: ' + error.message);
    }
};

// ============================================
// MODAL FUNCTIONS
// ============================================

window.openModal = function() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.classList.add('show');
    document.body.style.overflow = 'hidden';
};

window.closeModal = function() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    editingTaskId = null;
    
    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = 'Add New Task';
    
    const submitBtn = document.querySelector('.modal .submit-btn');
    if (submitBtn) submitBtn.textContent = 'Create Task';
    
    const taskForm = document.getElementById('taskForm');
    if (taskForm) taskForm.reset();
    
    const statusSelect = document.getElementById('modalTaskStatus');
    if (statusSelect) statusSelect.value = 'pending';
    
    const ticketNumber = document.getElementById('modalTicketNumber');
    if (ticketNumber) ticketNumber.value = '';
};

window.openDetailModal = function() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.classList.add('show');
    document.body.style.overflow = 'hidden';
};

window.closeDetailModal = function() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    viewingTaskId = null;
    editingRemarkId = null;
};

// Create/Update task
document.addEventListener('DOMContentLoaded', () => {
    const taskForm = document.getElementById('taskForm');
    if (taskForm) {
        taskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const title = document.getElementById('modalTaskTitle');
            const description = document.getElementById('modalTaskDescription');
            const priority = document.getElementById('modalTaskPriority');
            const status = document.getElementById('modalTaskStatus');
            const deadline = document.getElementById('modalTaskDeadline');
            const assignedTo = document.getElementById('modalTaskAssignTo');
            const ticketNumber = document.getElementById('modalTicketNumber');
            
            if (!title || !title.value) {
                alert('Please enter a task title');
                return;
            }
            
            const taskData = {
                title: title.value,
                description: description ? description.value : '',
                priority: priority ? priority.value : 'medium',
                status: status ? status.value : 'pending'
            };
            
            // Add ticket number if provided
            if (ticketNumber && ticketNumber.value) {
                taskData.ticket_number = ticketNumber.value;
            } else if (!editingTaskId) {
                // Only generate if not editing and no ticket number provided
                taskData.ticket_number = `TASK-${Date.now().toString().slice(-6)}`;
            }
            
            // For non-admin, auto-assign to self
            if (currentUserProfile?.role !== 'admin') {
                taskData.created_by = currentUser.id;
                taskData.assigned_to = currentUser.id;
            } else {
                taskData.created_by = currentUser.id;
                if (assignedTo && assignedTo.value) {
                    taskData.assigned_to = assignedTo.value;
                }
            }
            
            if (deadline && deadline.value) taskData.deadline = deadline.value;
            
            try {
                let error;
                if (editingTaskId) {
                    // Update existing task - include updated_at if column exists
                    taskData.updated_at = new Date();
                    const result = await window.supabaseClient
                        .from('tasks')
                        .update(taskData)
                        .eq('id', editingTaskId);
                    error = result.error;
                } else {
                    // Create new task
                    const result = await window.supabaseClient
                        .from('tasks')
                        .insert(taskData);
                    error = result.error;
                }
                
                if (error) {
                    alert('Error ' + (editingTaskId ? 'updating' : 'creating') + ' task: ' + error.message);
                } else {
                    closeModal();
                    await loadTasks();
                }
            } catch (error) {
                alert('Error ' + (editingTaskId ? 'updating' : 'creating') + ' task: ' + error.message);
            }
        });
    }
});

// ============================================
// USER MANAGEMENT (ADMIN)
// ============================================

// Load users for task assignment dropdown
async function loadUsersForAssignment() {
    try {
        const { data, error } = await window.supabaseClient
            .from('profiles')
            .select('id, email, full_name');
        
        if (error) {
            console.error('Error loading users:', error);
            return;
        }
        
        // For modal dropdown
        const select = document.getElementById('modalTaskAssignTo');
        if (select) {
            select.innerHTML = '<option value="">Unassigned</option>';
            if (data) {
                data.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.id;
                    option.textContent = user.full_name || user.email;
                    if (user.id === currentUser?.id) option.textContent += ' (Me)';
                    select.appendChild(option);
                });
            }
        }
        
        // For admin users table
        if (currentUserProfile?.role === 'admin') {
            await loadAllUsers();
        }
    } catch (error) {
        console.error('Error in loadUsersForAssignment:', error);
    }
}

// Load all users for admin
async function loadAllUsers() {
    try {
        const { data, error } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('Error loading users:', error);
            return;
        }
        
        const tbody = document.querySelector('#usersTable tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data) {
            data.forEach(user => {
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td>${escapeHtml(user.email)}</td>
                    <td>
                        <select onchange="updateUserRole('${user.id}', this.value)" ${user.id === currentUser?.id ? 'disabled' : ''}>
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    </td>
                    <td>
                        <button class="reset-password-btn" onclick="resetUserPassword('${user.email}')">Reset Password</button>
                    </td>
                `;
            });
        }
    } catch (error) {
        console.error('Error in loadAllUsers:', error);
    }
}

// Update user role
window.updateUserRole = async function(userId, newRole) {
    try {
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);
        
        if (error) {
            alert('Error updating role: ' + error.message);
        } else {
            alert('User role updated successfully');
            await loadAllUsers();
        }
    } catch (error) {
        alert('Error updating role: ' + error.message);
    }
};

// Reset user password
window.resetUserPassword = async function(email) {
    if (confirm(`Send password reset email to ${email}?`)) {
        try {
            const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/index.html'
            });
            
            if (error) {
                alert('Error sending reset email: ' + error.message);
            } else {
                alert('Password reset email sent successfully!');
            }
        } catch (error) {
            alert('Error sending reset email: ' + error.message);
        }
    }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    init();
});
