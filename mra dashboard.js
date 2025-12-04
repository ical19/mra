// ==UserScript==
// @name         MRA DASHBOARD OFFLINE DEBUG
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  MRA dashboard offline
// @author       You
// @match        https://tunastoyota.crm5.dynamics.com/api/data/v9.1/xts_ordertypes?fetchXml=mramanajemen
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      tunastoyota.crm5.dynamics.com
// @connect      pjawwektzazcxakgopou.supabase.co
// @connect      cloudinary.com
// @connect      res.cloudinary.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js
// @require      https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
// ==/UserScript==

(function() {
    'use strict';

    // Konfigurasi Supabase
    const supabaseUrl = 'https://pjawwektzazcxakgopou.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqYXd3ZWt0emF6Y3hha2dvcG91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyNjQ5MTUsImV4cCI6MjA3Mzg0MDkxNX0.dNEB80t7LcTsvAtHHqgIeJfxcwmmZNsWxPTIAlrj11c';

    let supabase;
    let currentUser = null;
    let currentEstimasiId = null;

    class MRAFollowUpApp {
        constructor() {
            this.currentTab = 'estimasi-not-accept';
            this.estimasiData = [];
            this.filteredData = [];
            this.sortConfig = { key: null, direction: 'asc' };
            this.currentDetail = null;
            this.selectedId = null;
            this.itemsPerPage = 25;
            this.currentPage = 1;
            this.customerDetail = null;
            this.accRenderPending = false;
            this.searchState = {
                term: '',
                date: '',
                showAll: true // ✅ BARU: flag untuk tampilkan semua data
            };
            this.originalData = []; // ✅ BARU: simpan data asli

            // Set tanggal default
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            this.searchState.date = firstDay.toISOString().split('T')[0];

            this.diskonSettings = {
                sparepart: 0,
                jasa: 0,
                manualSparepart: {},
                manualJasa: {}
            };
            this.selectedTemplateType = 'inti_estimasi';
            window.app = this;

            console.log('🔄 MRAFollowUpApp initialized'); // Debug log
            this.init();
        }

        async init() {
            await this.initializeSupabase();
            await this.authenticateUser();
            this.createUI();
            await this.loadData();

            this.attachGlobalEvents();

        }

        async initializeSupabase() {
            supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
        }

        async authenticateUser() {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: 'kirangasem@gmail.com',
                password: '123456'
            });

            if (error) {
                console.error('Login error:', error);
                return;
            }

            currentUser = data.user;
            console.log('User logged in:', currentUser.email);
        }

        // Tambahkan method baru untuk update tampilan template
        updateTemplateDisplay(templateType = 'formal_ramah') {
            if (!this.currentDetail) return;

            const templateDisplay = document.getElementById('whatsapp-template-display');
            if (templateDisplay) {
                const newTemplate = this.generateWhatsAppTemplateByType(this.currentDetail, templateType);
                templateDisplay.innerHTML = newTemplate;
            }
        }

        attachGlobalEvents() {
            // Download PDF event - DIPERBAIKI
            document.addEventListener('click', (e) => {
                const target = e.target;

                // Handle download PDF
                if (target.id === 'download-pdf' || target.closest('#download-pdf')) {
                    e.preventDefault();
                    if (this.currentDetail) {
                        this.downloadPDFHandler();
                    } else {
                        this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                    }
                    return;
                }

                // Sync CRM event
                if (target.id === 'sync-crm' || target.closest('#sync-crm')) {
                    e.preventDefault();
                    this.syncWithCRM5();
                    return;
                }

                // Check Work Order event
                if (target.id === 'check-workorder' || target.closest('#check-workorder')) {
                    e.preventDefault();
                    this.checkWorkOrder();
                    return;
                }

                // Manual diskon button
                if (target.id === 'manual-diskon-btn' || target.closest('#manual-diskon-btn')) {
                    e.preventDefault();
                    this.showManualDiskonModal();
                    return;
                }

                // Template buttons dengan event delegation
                if (target.closest('.template-btn') && !target.closest('.edit-template-btn')) {
                    e.preventDefault();
                    const templateBtn = target.closest('.template-btn');
                    const templateType = templateBtn.getAttribute('data-template');
                    this.handleTemplateButtonClick(templateType, templateBtn);
                    return;
                }

                // Edit template buttons
                if (target.closest('.edit-template-btn')) {
                    e.preventDefault();
                    const editBtn = target.closest('.edit-template-btn');
                    const templateType = editBtn.getAttribute('data-template');
                    this.openTemplateEditor(templateType);
                    return;
                }
            });
        }

        // Method untuk handle template button click
        handleTemplateButtonClick(templateType, buttonElement) {
            // Update tampilan template
            this.updateTemplateDisplay(templateType);

            // Highlight tombol yang aktif
            document.querySelectorAll('.template-btn').forEach(b => {
                b.style.background = '#e3f2fd';
                b.style.color = '#1976d2';
                b.style.border = '1px solid #bbdefb';
                b.classList.remove('active');
            });

            buttonElement.style.background = '#1976d2';
            buttonElement.style.color = 'white';
            buttonElement.style.border = '1px solid #1976d2';
            buttonElement.classList.add('active');

            // Simpan template yang dipilih
            this.selectedTemplateType = templateType;
        }

        // Method khusus untuk download PDF
        downloadPDFHandler() {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            // Simpan state manual diskon sebelum generate PDF
            console.log('📊 Manual diskon sebelum generate PDF:');
            console.log('  - Manual Sparepart:', this.diskonSettings.manualSparepart);
            console.log('  - Manual Jasa:', this.diskonSettings.manualJasa);

            // Panggil fungsi generate PDF dengan menggunakan this sebagai context
            generatePdfA5.call(this);
        }

        clearFilters() {
            const searchInput = document.getElementById('search-not-accept');
            const dateFilter = document.getElementById('date-filter-not-accept');

            if (searchInput) searchInput.value = '';
            if (dateFilter) {
                const today = new Date();
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                dateFilter.value = firstDay.toISOString().split('T')[0];
            }

            this.filterNotAcceptData('');
        }

        updateSearchInputValue() {
            const searchInput = document.getElementById('search-not-accept');
            if (searchInput && searchInput.value !== this.searchState.term) {
                searchInput.value = this.searchState.term;

                // ✅ OTOMATIS FOKUS DAN SET CURSOR POSISI
                this.focusSearchInput();
            }
        }

        focusSearchInput() {
            const searchInput = document.getElementById('search-not-accept');
            if (searchInput) {
                setTimeout(() => {
                    searchInput.focus();
                    // Set cursor ke akhir text
                    const length = searchInput.value.length;
                    searchInput.setSelectionRange(length, length);
                    console.log('🎯 Search input re-focused');
                }, 10);
            }
        }

        resetFilters() {
            console.log('🔄 Resetting all filters...');

            // ✅ RESET SEMUA STATE TAPI showAll TETAP TRUE
            this.searchState.term = '';
            this.searchState.date = '';
            // this.searchState.showAll = true; // ✅ JANGAN reset showAll, biarkan true

            // Set tanggal default
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            this.searchState.date = firstDay.toISOString().split('T')[0];

            // ✅ KEMBALI KE SEMUA DATA (karena showAll = true)
            this.filteredData = [...this.originalData];

            console.log('✅ Filters reset. Showing all data:', this.filteredData.length);
            this.renderCurrentTab();
            this.showNotification('Filter berhasil direset - Menampilkan semua data', 'success');
        }

        // ✅ METHOD UNTUK TOGGLE SHOW ALL DATA - PERBAIKI
        toggleShowAll() {
            // ✅ TOGGLE STATE
            this.searchState.showAll = !this.searchState.showAll;

            const mode = this.searchState.showAll ? 'SEMUA DATA' : 'HANYA COMPLETED';
            console.log(`🔄 Switching to: ${mode}`);

            // ✅ PANGGIL filterNotAcceptData DENGAN TERM YANG ADA
            // Ini akan menerapkan semua filter dengan mode baru
            this.filterNotAcceptData(this.searchState.term);

            this.showNotification(
                this.searchState.showAll ? 'Menampilkan semua data' : 'Menampilkan hanya data completed',
                'info'
            );
        }

        clearSearch() {
            this.searchState.term = '';
            this.searchState.date = '';

            // Reset ke tanggal default
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            this.searchState.date = firstDay.toISOString().split('T')[0];

            this.filterNotAcceptData('');
        }

        async checkWorkOrder() {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            try {
                const estimasi = this.currentDetail;

                if (!estimasi.nopol) {
                    this.showNotification('Nomor polisi tidak tersedia', 'error');
                    return;
                }

                // Tampilkan loading state
                const checkBtn = document.getElementById('check-workorder');
                if (checkBtn) {
                    checkBtn.innerHTML = '<i class="material-icons">search</i> Loading...';
                    checkBtn.disabled = true;
                }

                this.showNotification('Mencari data work order...', 'info');

                // Fetch data work order dari CRM5
                const workOrderData = await this.fetchWorkOrderData(estimasi.nopol);

                if (workOrderData && workOrderData.length > 0) {
                    this.showWorkOrderResults(workOrderData);
                    this.showNotification(`Ditemukan ${workOrderData.length} work order`, 'success');
                } else {
                    this.showNotification('Tidak ada work order ditemukan', 'warning');
                }

            } catch (error) {
                console.error('Check work order error:', error);
                this.showNotification('Error cek work order: ' + error.message, 'error');
            } finally {
                // Reset button state
                const checkBtn = document.getElementById('check-workorder');
                if (checkBtn) {
                    checkBtn.innerHTML = '<i class="material-icons">search</i>';
                    checkBtn.disabled = false;
                }
            }
        }

        checkEstimasiCompleteness(estimasi) {
            let hasSparepart = false;
            let hasService = false;

            // Cek sparepart
            if (estimasi.sparepart_data) {
                try {
                    const spareparts = typeof estimasi.sparepart_data === 'string'
                    ? JSON.parse(estimasi.sparepart_data)
                    : estimasi.sparepart_data;

                    if (Array.isArray(spareparts) && spareparts.length > 0) {
                        // Cek apakah ada minimal satu sparepart dengan harga > 0
                        hasSparepart = spareparts.some(part => {
                            const price = parseFloat(part.price) || 0;
                            const qty = parseFloat(part.qty) || 1;
                            return price > 0 && (price * qty) > 0;
                        });
                    }
                } catch (e) {
                    console.error('Error parsing sparepart data:', e);
                }
            }

            // Cek jasa
            if (estimasi.service_data) {
                try {
                    const services = typeof estimasi.service_data === 'string'
                    ? JSON.parse(estimasi.service_data)
                    : estimasi.service_data;

                    if (Array.isArray(services) && services.length > 0) {
                        // Cek apakah ada minimal satu service dengan harga > 0
                        hasService = services.some(service => {
                            const price = parseFloat(service.price) || 0;
                            const hour = parseFloat(service.hour) || 1;
                            return price > 0 && (price * hour) > 0;
                        });
                    }
                } catch (e) {
                    console.error('Error parsing service data:', e);
                }
            }

            return { hasSparepart, hasService };
        }

        async fetchWorkOrderData(nopol) {
            return new Promise((resolve, reject) => {
                // URL fetch XML untuk mencari berdasarkan nomor polisi
                const fetchUrl = `https://tunastoyota.crm5.dynamics.com/api/data/v9.0/xts_workorders?fetchXml=%3Cfetch%20version%3D%221.0%22%20output-format%3D%22xml-platform%22%20mapping%3D%22logical%22%20distinct%3D%22false%22%20savedqueryid%3D%22edb1eb56-b65a-4a8a-a190-2b4c80d62d79%22%20returntotalrecordcount%3D%22true%22%20page%3D%221%22%20count%3D%2250%22%20no-lock%3D%22false%22%3E%3Centity%20name%3D%22xts_workorder%22%3E%3Cattribute%20name%3D%22statecode%22%2F%3E%3Cattribute%20name%3D%22xts_workorder%22%2F%3E%3Cattribute%20name%3D%22xts_businessunitid%22%2F%3E%3Cattribute%20name%3D%22xts_transactiondate%22%2F%3E%3Cattribute%20name%3D%22xts_ordertypeid%22%2F%3E%3Cattribute%20name%3D%22xts_workorderstatus%22%2F%3E%3Cattribute%20name%3D%22xts_customerid%22%2F%3E%3Cattribute%20name%3D%22xts_platenumber%22%2F%3E%3Cattribute%20name%3D%22xts_totalpartsamount%22%2F%3E%3Cattribute%20name%3D%22xts_totalworkamount%22%2F%3E%3Cattribute%20name%3D%22xts_totalmiscchargeamount%22%2F%3E%3Cattribute%20name%3D%22xts_totalothersalesamount%22%2F%3E%3Cattribute%20name%3D%22xts_grandtotalamount%22%2F%3E%3Cattribute%20name%3D%22xts_actualarrivaldateandtime%22%2F%3E%3Cattribute%20name%3D%22xts_actualfinishdateandtime%22%2F%3E%3Cattribute%20name%3D%22xts_maintenancemodelid%22%2F%3E%3Cattribute%20name%3D%22xti_technicalcompleted%22%2F%3E%3Cattribute%20name%3D%22xts_queuestatus%22%2F%3E%3Cattribute%20name%3D%22xts_serviceadvisorid%22%2F%3E%3Corder%20attribute%3D%22xts_transactiondate%22%20descending%3D%22true%22%2F%3E%3Corder%20attribute%3D%22xts_workorder%22%20descending%3D%22true%22%2F%3E%3Cfilter%20type%3D%22and%22%3E%3Ccondition%20attribute%3D%22statecode%22%20operator%3D%22eq%22%20value%3D%220%22%2F%3E%3C%2Ffilter%3E%3Clink-entity%20name%3D%22account%22%20from%3D%22accountid%22%20to%3D%22xts_customerid%22%20visible%3D%22false%22%20link-type%3D%22outer%22%20alias%3D%22a_2896a0f8ff0eec11b6e500224816bfa8%22%3E%3Cattribute%20name%3D%22xts_customerclassid%22%2F%3E%3C%2Flink-entity%3E%3Cattribute%20name%3D%22xts_workorderid%22%2F%3E%3Cfilter%20type%3D%22or%22%20isquickfindfields%3D%221%22%3E%3Ccondition%20attribute%3D%22xts_platenumber%22%20operator%3D%22like%22%20value%3D%22${nopol}%25%22%2F%3E%3C%2Ffilter%3E%3C%2Fentity%3E%3C%2Ffetch%3E`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: fetchUrl,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    onload: function(response) {
                        if (response.status === 200) {
                            const data = JSON.parse(response.responseText);
                            resolve(data.value || []);
                        } else {
                            reject(new Error(`CRM5 API error: ${response.status}`));
                        }
                    },
                    onerror: function(error) {
                        reject(error);
                    }
                });
            });
        }

        showWorkOrderResults(workOrders) {
            // Hapus results sebelumnya jika ada
            const existingResults = document.getElementById('workorder-results');
            if (existingResults) {
                existingResults.remove();
            }

            const resultsHtml = `
        <div id="workorder-results" style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0; margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #1e3c72;">list_alt</i>
                    Customer Service Record (${workOrders.length} PKB)
                </h4>
                <button id="close-workorder-results" class="btn-small" style="display: flex; align-items: center; gap: 4px; padding: 6px 10px; font-size: 12px;">
                    <i class="material-icons" style="font-size: 16px;">close</i>
                    Close
                </button>
            </div>

            <div style="max-height: 300px; overflow-y: auto;">
                ${workOrders.map((order, index) => `
                    <div class="workorder-item" data-workorder-id="${order.xts_workorderid}" style="padding: 12px; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s ease;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: 14px; color: #333;">
                                    ${index + 1}. ${order.xts_workorder || 'N/A'}
                                </div>
                                <div style="font-size: 12px; color: #666; margin-top: 4px;">
                                    ${order.xts_transactiondate ? new Date(order.xts_transactiondate).toLocaleDateString('id-ID') : 'N/A'}  Status PKB: ${order.xts_workorderstatus == 3 ? 'Released' : order.xts_workorderstatus == 4 ? 'Ready To be Invoiced' : order.xts_workorderstatus == 5 ? 'Invoiced' : order.xts_workorderstatus == 122 ? 'Partial Invoiced' : order.xts_workorderstatus == 7 ? 'Finished' : order.xts_workorderstatus == 1 ? 'Open' : 'Unknown' || 'N/A'}
                                </div>
                            </div>
                            <button class="btn-open-workorder btn-small" style="margin-left: 10px; display: flex; align-items: center; gap: 4px; padding: 6px 10px; font-size: 12px;">
                                <i class="material-icons" style="font-size: 14px;">open_in_new</i>
                                Buka
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

            // Temukan container pengaturan diskon dan sisipkan results di atasnya
            const diskonContainer = document.querySelector('.panel-colored');
            if (diskonContainer) {
                diskonContainer.insertAdjacentHTML('afterbegin', resultsHtml);
                this.attachWorkOrderEvents(workOrders);
            }
        }

        getWorkOrderStatusText(statusCode) {
            const statusMap = {
                1: 'Draft',
                2: 'Active',
                3: 'In Process',
                4: 'Completed',
                5: 'Canceled'
            };
            return statusMap[statusCode] || 'Unknown';
        }

        attachWorkOrderEvents(workOrders) {
            // Close button
            const closeBtn = document.getElementById('close-workorder-results');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    const results = document.getElementById('workorder-results');
                    if (results) {
                        results.remove();
                    }
                });
            }

            // Work order item click
            document.querySelectorAll('.workorder-item').forEach((item, index) => {
                item.addEventListener('click', (e) => {
                    // Hapus active state dari semua item
                    document.querySelectorAll('.workorder-item').forEach(i => {
                        i.style.background = 'white';
                        i.style.borderColor = '#e0e0e0';
                    });

                    // Set active state untuk item yang diklik
                    item.style.background = '#e3f2fd';
                    item.style.borderColor = '#2196f3';

                    // Jika yang diklik adalah tombol buka, langsung buka link
                    if (e.target.closest('.btn-open-workorder')) {
                        this.openWorkOrderInCRM(workOrders[index]);
                    }
                });
            });

            // Tombol buka work order
            document.querySelectorAll('.btn-open-workorder').forEach((btn, index) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Mencegah trigger event parent
                    this.openWorkOrderInCRM(workOrders[index]);
                });
            });
        }

        attachOtherEvents() {
            // Manual diskon button
            const manualDiskonBtn = document.getElementById('manual-diskon-btn');
            if (manualDiskonBtn) {
                manualDiskonBtn.addEventListener('click', () => {
                    this.showManualDiskonModal();
                });
            }

            // Diskon settings
            const discSparepartMid = document.getElementById('disc-sparepart-mid');
            const discJasaMid = document.getElementById('disc-jasa-mid');

            const updateDiskonSettings = () => {
                this.diskonSettings.sparepart = parseInt(discSparepartMid?.value) || 0;
                this.diskonSettings.jasa = parseInt(discJasaMid?.value) || 0;
                this.renderCurrentTab();
            };

            if (discSparepartMid) {
                discSparepartMid.addEventListener('change', updateDiskonSettings);
                discSparepartMid.addEventListener('input', updateDiskonSettings);
            }

            if (discJasaMid) {
                discJasaMid.addEventListener('change', updateDiskonSettings);
                discJasaMid.addEventListener('input', updateDiskonSettings);
            }

            // Event untuk navigasi foto
            this.attachFotoEvents();

            // Button events
            this.attachButtonEvents();
        }

        openWorkOrderInCRM(workOrder) {
            if (!workOrder || !workOrder.xts_workorderid) {
                this.showNotification('Data work order tidak valid', 'error');
                return;
            }

            // URL untuk membuka work order di CRM5
            const crmUrl = `https://tunastoyota.crm5.dynamics.com/main.aspx?appid=984780dc-bd92-ec11-b400-00224815faf4&pagetype=entityrecord&etn=xts_workorder&id=${workOrder.xts_workorderid}&formid=36352158-4a51-4915-9f8e-e4539cfe3ac1`;

            // Hitung ukuran popup berdasarkan ukuran layar
            const width = Math.min(1400, window.screen.width - 100);
            const height = Math.min(800, window.screen.height - 100);
            const left = (window.screen.width - width) / 2;
            const top = (window.screen.height - height) / 2;

            const windowFeatures = `
        width=${width},
        height=${height},
        left=${left},
        top=${top},
        menubar=no,
        toolbar=no,
        location=no,
        status=no,
        resizable=yes,
        scrollbars=yes
    `.replace(/\s/g, '');

            try {
                const popupWindow = window.open(crmUrl, `CRM_WorkOrder_${workOrder.xts_workorderid}`, windowFeatures);

                if (popupWindow) {
                    popupWindow.focus();

                    // Optional: Tambahkan event listener untuk menangani ketika popup ditutup
                    const checkPopupClosed = setInterval(() => {
                        if (popupWindow.closed) {
                            clearInterval(checkPopupClosed);
                            console.log('Popup work order ditutup');
                        }
                    }, 1000);

                } else {
                    throw new Error('Popup diblokir oleh browser');
                }

            } catch (error) {
                console.error('Error membuka popup:', error);
                this.showNotification('Popup diblokir, membuka di tab baru...', 'warning');

                // Fallback ke tab baru
                window.open(crmUrl, '_blank');
                // Tambahkan di method openWorkOrderInCRM() setelah window.open()
                this.showNotification('Membuka work order di popup window...', 'info');
            }
        }

        async syncWithCRM5() {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            try {
                this.showNotification('Mencari data CRM5...', 'info');

                const estimasi = this.currentDetail;

                if (!estimasi.nopol) {
                    this.showNotification('Nomor polisi tidak tersedia', 'error');
                    return;
                }

                // Tampilkan loading state
                const syncBtn = document.getElementById('sync-crm');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="material-icons">sync</i> Loading...';
                    syncBtn.disabled = true;
                }

                // Fetch data dari CRM5
                const crmData = await this.fetchCRM5Data(estimasi.nopol);

                if (crmData) {
                    this.showNotification('Data CRM5 ditemukan! Memperbarui...', 'success');

                    // Update data estimasi dengan informasi dari CRM5
                    const { changesCount, vehicleCache } = await this.updateEstimasiFromCRM5(estimasi.id, estimasi, crmData);

                    // Tampilkan popup hasil sync
                    this.showSyncResultsPopup(crmData, changesCount, vehicleCache);

                    // Refresh data
                    await this.loadData();

                    this.showNotification('Data berhasil disinkronisasi dengan CRM5!', 'success');
                } else {
                    this.showNotification('Data tidak ditemukan di CRM5', 'warning');
                }

            } catch (error) {
                console.error('Sync CRM5 error:', error);
                this.showNotification('Error sync CRM5: ' + error.message, 'error');
            } finally {
                // Reset button state
                const syncBtn = document.getElementById('sync-crm');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="material-icons">sync</i>';
                    syncBtn.disabled = false;
                }
            }
        }

        // Method helper untuk membersihkan nomor telepon
        cleanPhoneNumber(phone) {
            if (!phone) return '';

            // Hapus semua karakter non-digit
            let cleaned = phone.toString().replace(/\D/g, '');

            // Handle format Indonesia
            if (cleaned.startsWith('0')) {
                cleaned = '62' + cleaned.substring(1);
            } else if (cleaned.startsWith('8')) {
                cleaned = '62' + cleaned;
            }

            return cleaned;
        }

        // Method helper untuk format nama customer
        formatCustomerName(name) {
            if (!name) return '';

            let formattedName = name.toString().trim();

            // Handle format PT/Perusahaan
            if (formattedName.toUpperCase().startsWith('PT ')) {
                return formattedName.toUpperCase();
            }

            // Handle format dengan slash (JOHN/PT MIGAS)
            if (formattedName.includes('/')) {
                const parts = formattedName.split('/').map(part => part.trim());
                const formattedParts = parts.map(part => {
                    if (part.toUpperCase().startsWith('PT ')) {
                        return part.toUpperCase(); // PT di-uppercase semua
                    } else {
                        // Nama orang - uppercase hanya huruf pertama tiap kata
                        return part.replace(/\w\S*/g, function(txt) {
                            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                        });
                    }
                });
                return formattedParts.join(' / ');
            }

            // Default: uppercase hanya huruf pertama tiap kata untuk nama orang
            return formattedName.replace(/\w\S*/g, function(txt) {
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            });
        }

        // Method untuk mengambil data kendaraan dari CRM5 (CACHE ONLY)
        async fetchVehicleInfo(nopol) {
            return new Promise((resolve, reject) => {
                if (!nopol) {
                    resolve([]);
                    return;
                }

                const fetchXml = `
            <fetch version="1.0" output-format="xml-platform" mapping="logical" distinct="false">
                <entity name="xts_vehicleinformation">
                    <attribute name="xts_vehicleinformationid"/>
                    <attribute name="xts_platenumber"/>
                    <attribute name="xts_vehicleidentificationnumber"/>
                    <attribute name="xts_productdescription"/>
                    <attribute name="xts_productionyear"/>
                    <filter type="and">
                        <condition attribute="statecode" operator="eq" value="0"/>
                    </filter>
                    <filter type="or">
                        <condition attribute="xts_platenumber" operator="like" value="${nopol}%"/>
                    </filter>
                </entity>
            </fetch>
        `;

                const apiUrl = `https://tunastoyota.crm5.dynamics.com/api/data/v9.0/xts_vehicleinformations?fetchXml=${encodeURIComponent(fetchXml)}`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: apiUrl,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    onload: function(response) {
                        if (response.status === 200) {
                            const data = JSON.parse(response.responseText);
                            resolve(data.value || []);
                        } else {
                            reject(new Error(`Vehicle API error: ${response.status}`));
                        }
                    },
                    onerror: function(error) {
                        reject(error);
                    }
                });
            });
        }

        showSyncResultsPopup(crmData, changesCount, vehicleCache = null) {
            const popup = document.createElement('div');
            popup.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #2196F3, #21CBF3);
        color: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 450px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        border-left: 5px solid #1976D2;
        animation: slideInRight 0.5s ease-out;
        backdrop-filter: blur(10px);
    `;

            // Data yang ditemukan dari CRM5
            const itemsFound = [];

            // Data yang diupdate ke database
            itemsFound.push(`<div style="background: rgba(255,255,255,0.3); padding: 8px; border-radius: 6px; margin-bottom: 8px;">
        <strong>📊 Data yang Diupdate ke Database:</strong>
    </div>`);

            if (crmData.xts_platenumber) itemsFound.push(`🚗 <strong>Nomor Polisi:</strong> ${crmData.xts_platenumber}`);
            if (crmData.xts_customerid) itemsFound.push(`👤 <strong>Customer ID:</strong> ${crmData.xts_customerid}`);
            if (crmData.xts_contactpersonphone) itemsFound.push(`📞 <strong>Telepon CRM:</strong> ${crmData.xts_contactpersonphone}`);
            if (crmData.xts_vehicleidentificationnumber) itemsFound.push(`🔢 <strong>Nomor Rangka:</strong> ${crmData.xts_vehicleidentificationnumber}`);

            // Info tambahan dari cache
            if (vehicleCache) {
                itemsFound.push(`<div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 6px; margin: 8px 0;">
            <strong>💾 Info Tambahan (Cache):</strong>
        </div>`);

                if (vehicleCache.xts_vehicleidentificationnumber)
                    itemsFound.push(`🔢 <strong>VIN:</strong> ${vehicleCache.xts_vehicleidentificationnumber}`);
                if (vehicleCache.xts_productdescription)
                    itemsFound.push(`🚘 <strong>Model:</strong> ${vehicleCache.xts_productdescription}`);
                if (vehicleCache.xts_productionyear)
                    itemsFound.push(`📅 <strong>Tahun:</strong> ${vehicleCache.xts_productionyear}`);
            }

            popup.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                <i class="material-icons" style="font-size: 20px;">sync</i>
                Data Ditemukan di CRM5
            </h4>
            <button id="close-popup" style="background: none; border: none; color: white; cursor: pointer; padding: 4px; border-radius: 50%; transition: background 0.2s;">
                <i class="material-icons" style="font-size: 18px;">close</i>
            </button>
        </div>

        <div style="font-size: 13px; line-height: 1.4; margin-bottom: 10px;">
            <div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">
                ${itemsFound.length > 0 ?
                itemsFound.map(item => `<div style="margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">${item}</div>`).join('')
            : '<div style="color: #ffeb3b;">⚠️ Tidak ada data yang bisa diupdate</div>'
        }
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; background: rgba(255,255,255,0.2); padding: 8px; border-radius: 6px;">
            <span>🔄 Field yang diupdate: <strong>${changesCount}</strong></span>
            <span>⏱️ Auto close: <strong>8s</strong></span>
        </div>

        <!-- Progress bar -->
        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px; margin-top: 10px; overflow: hidden;">
            <div id="popup-progress" style="width: 100%; height: 100%; background: #4CAF50; border-radius: 2px; transition: width 8s linear;"></div>
        </div>
    `;

            document.body.appendChild(popup);

            // Animate progress bar
            setTimeout(() => {
                const progressBar = popup.querySelector('#popup-progress');
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
            }, 100);

            // Close button event
            const closeBtn = popup.querySelector('#close-popup');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    popup.remove();
                });

                closeBtn.addEventListener('mouseenter', () => {
                    closeBtn.style.background = 'rgba(255,255,255,0.2)';
                });
                closeBtn.addEventListener('mouseleave', () => {
                    closeBtn.style.background = 'none';
                });
            }

            // Auto remove setelah 8 detik
            setTimeout(() => {
                if (document.body.contains(popup)) {
                    popup.style.animation = 'slideOutRight 0.5s ease-in';
                    setTimeout(() => {
                        if (document.body.contains(popup)) {
                            popup.remove();
                        }
                    }, 500);
                }
            }, 8000);
        }

        async fetchCRM5Data(nopol) {
            return new Promise((resolve, reject) => {
                const fetchUrl = `https://tunastoyota.crm5.dynamics.com/api/data/v9.0/xts_workorders?fetchXml=%3Cfetch%20version%3D%221.0%22%20output-format%3D%22xml-platform%22%20mapping%3D%22logical%22%20distinct%3D%22false%22%20savedqueryid%3D%22edb1eb56-b65a-4a8a-a190-2b4c80d62d79%22%20returntotalrecordcount%3D%22true%22%20page%3D%221%22%20count%3D%2250%22%20no-lock%3D%22false%22%3E%3Centity%20name%3D%22xts_workorder%22%3E%3Cattribute%20name%3D%22statecode%22%2F%3E%3Cattribute%20name%3D%22xts_workorder%22%2F%3E%3Cattribute%20name%3D%22xts_businessunitid%22%2F%3E%3Cattribute%20name%3D%22xts_transactiondate%22%2F%3E%3Cattribute%20name%3D%22xts_ordertypeid%22%2F%3E%3Cattribute%20name%3D%22xts_workorderstatus%22%2F%3E%3Cattribute%20name%3D%22xts_customerid%22%2F%3E%3Cattribute%20name%3D%22xts_platenumber%22%2F%3E%3Cattribute%20name%3D%22xts_totalpartsamount%22%2F%3E%3Cattribute%20name%3D%22xts_totalworkamount%22%2F%3E%3Cattribute%20name%3D%22xts_contactpersonid%22%2F%3E%3Cattribute%20name%3D%22xts_totalmiscchargeamount%22%2F%3E%3Cattribute%20name%3D%22xts_totalothersalesamount%22%2F%3E%3Cattribute%20name%3D%22xts_grandtotalamount%22%2F%3E%3Cattribute%20name%3D%22xts_actualarrivaldateandtime%22%2F%3E%3Cattribute%20name%3D%22xts_actualfinishdateandtime%22%2F%3E%3Cattribute%20name%3D%22xts_maintenancemodelid%22%2F%3E%3Cattribute%20name%3D%22xti_technicalcompleted%22%2F%3E%3Cattribute%20name%3D%22xts_queuestatus%22%2F%3E%3Cattribute%20name%3D%22xts_serviceadvisorid%22%2F%3E%3Corder%20attribute%3D%22xts_transactiondate%22%20descending%3D%22true%22%2F%3E%3Corder%20attribute%3D%22xts_workorder%22%20descending%3D%22true%22%2F%3E%3Cfilter%20type%3D%22and%22%3E%3Ccondition%20attribute%3D%22statecode%22%20operator%3D%22eq%22%20value%3D%220%22%2F%3E%3C%2Ffilter%3E%3Clink-entity%20name%3D%22account%22%20from%3D%22accountid%22%20to%3D%22xts_customerid%22%20visible%3D%22false%22%20link-type%3D%22outer%22%20alias%3D%22a_2896a0f8ff0eec11b6e500224816bfa8%22%3E%3Cattribute%20name%3D%22xts_customerclassid%22%2F%3E%3C%2Flink-entity%3E%3Cattribute%20name%3D%22xts_workorderid%22%2F%3E%3Cattribute%20name%3D%22xts_contactpersonphone%22%2F%3E%3Clink-entity%20name%3D%22contact%22%20from%3D%22contactid%22%20to%3D%22xts_contactpersonid%22%20link-type%3D%22outer%22%20alias%3D%22a_ac9c1fe7eeef47228a4a87d3d017328d%22%20visible%3D%22false%22%3E%3Cattribute%20name%3D%22mobilephone%22%2F%3E%3C%2Flink-entity%3E%3Cfilter%20type%3D%22or%22%20isquickfindfields%3D%221%22%3E%3Ccondition%20attribute%3D%22xts_platenumber%22%20operator%3D%22like%22%20value%3D%22${nopol}%25%22%2F%3E%3C%2Ffilter%3E%3C%2Fentity%3E%3C%2Ffetch%3E`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: fetchUrl,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    onload: function(response) {
                        if (response.status === 200) {
                            const data = JSON.parse(response.responseText);
                            if (data.value && data.value.length > 0) {
                                resolve(data.value[0]); // Ambil data pertama
                            } else {
                                resolve(null); // Tidak ada data
                            }
                        } else {
                            reject(new Error(`CRM5 API error: ${response.status}`));
                        }
                    },
                    onerror: function(error) {
                        reject(error);
                    }
                });
            });
        }
        async updateEstimasiFromCRM5(estimasiId, currentData, crmData) {
            if (!crmData) return 0;

            const updates = {
                updated_at: new Date().toISOString(),
                mra_updated_at: new Date().toISOString()
            };

            console.log('🔍 Memulai sync CRM5...');
            console.log('📋 Data saat ini:', {
                nama: currentData.name_customer,
                telepon: currentData.telepon_customer,
                nopol: currentData.nopol,
                nomor_rangka: currentData.nomor_rangka
            });

            // ====================
            // 1. AMBIL DATA KENDARAAN UNTUK CACHE DAN UPDATE
            // ====================
            let vehicleCache = null;
            let finalNomorRangka = null;

            try {
                console.log('🚗 Mencari data kendaraan...');
                const vehicleInfo = await this.fetchVehicleInfo(currentData.nopol);

                if (vehicleInfo && vehicleInfo.length > 0) {
                    vehicleCache = vehicleInfo[0];

                    // PRIORITAS 1: Gunakan VIN dari data kendaraan
                    if (vehicleCache.xts_vehicleidentificationnumber) {
                        finalNomorRangka = vehicleCache.xts_vehicleidentificationnumber.toString().trim();
                        console.log('✅ VIN ditemukan dari data kendaraan:', finalNomorRangka);
                    }

                    // SIMPAN KE LOCALSTORAGE SEBAGAI CACHE
                    const cacheKey = `vehicle_cache_${currentData.nopol}`;
                    const cacheData = {
                        vin: vehicleCache.xts_vehicleidentificationnumber,
                        model: vehicleCache.xts_productdescription,
                        tahun: vehicleCache.xts_productionyear,
                        lastUpdated: new Date().toISOString()
                    };
                    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    console.log('💾 Data kendaraan disimpan di cache:', cacheData);
                } else {
                    console.log('ℹ️ Data kendaraan tidak ditemukan di CRM5');
                }
            } catch (error) {
                console.error('❌ Error mengambil data kendaraan:', error);
            }

            // ====================
            // 2. FALLBACK: Coba ambil VIN dari data CRM5 workorder
            // ====================
            if (!finalNomorRangka && crmData.xts_vehicleidentificationnumber) {
                finalNomorRangka = crmData.xts_vehicleidentificationnumber.toString().trim();
                console.log('✅ VIN ditemukan dari data workorder:', finalNomorRangka);
            }

            // ====================
            // 3. UPDATE NOMOR RANGKA JIKA ADA DATA BARU
            // ====================
            if (finalNomorRangka && finalNomorRangka !== "") {
                const currentRangka = currentData.nomor_rangka || '';

                console.log('🔢 Perbandingan nomor rangka:');
                console.log('   - Database:', currentRangka);
                console.log('   - CRM5:', finalNomorRangka);
                console.log('   - Sama?', currentRangka === finalNomorRangka);

                // PERBAIKAN: Update jika berbeda ATAU jika database kosong
                if (currentRangka !== finalNomorRangka || currentRangka === '') {
                    updates.nomor_rangka = finalNomorRangka;
                    console.log('✅ Akan update nomor rangka:', finalNomorRangka);
                } else {
                    console.log('ℹ️ Nomor rangka sama, tidak diupdate');
                }
            } else {
                console.log('❌ Nomor rangka tidak ditemukan di CRM5');
            }

            // ====================
            // 4. AMBIL DATA CUSTOMER DARI CRM5 (Contact & Account)
            // ====================
            const contactId = crmData["_xts_contactpersonid_value"];
            const customerId = crmData["_xts_customerid_value"];

            let namaContact = null;
            let namaAccount = null;
            let hpCRM = null;

            // 4.1 Ambil data dari Contact
            if (contactId) {
                try {
                    const contactUrl = `https://tunastoyota.crm5.dynamics.com/api/data/v9.0/contacts(${contactId})`;
                    const res = await fetch(contactUrl, {
                        headers: {
                            "Accept": "application/json;odata.metadata=full",
                            "OData-Version": "4.0"
                        },
                        credentials: "include"
                    });
                    const contact = await res.json();
                    namaContact = contact.fullname.toUpperCase() || contact.firstname.toUpperCase() || null;
                    hpCRM = contact.mobilephone || null;
                    console.log('📞 Data Contact:', { namaContact, hpCRM });
                } catch (e) {
                    console.warn("❌ Gagal mengambil data contact:", e);
                }
            }

            // 4.2 Ambil data dari Account
            if (customerId) {
                try {
                    const accountUrl = `https://tunastoyota.crm5.dynamics.com/api/data/v9.0/accounts(${customerId})`;
                    const res = await fetch(accountUrl, {
                        headers: {
                            "Accept": "application/json;odata.metadata=full",
                            "OData-Version": "4.0"
                        },
                        credentials: "include"
                    });
                    const account = await res.json();
                    namaAccount = account.name.toUpperCase() || account.xts_firstname.toUpperCase() || null;
                    console.log('👤 Data Account:', { namaAccount });
                } catch (e) {
                    console.warn("❌ Gagal mengambil data account:", e);
                }
            }

            // 4.3 Coba ambil nomor telepon dari field lain di CRM5
            if (!hpCRM) {
                hpCRM = crmData.xts_contactpersonphone ||
                    crmData['a_ac9c1fe7eeef47228a4a87d3d017328d.mobilephone'] ||
                    null;
                console.log('📱 Coba ambil HP dari field lain:', hpCRM);
            }

            // ====================
            // 5. UPDATE NAMA CUSTOMER (name_customer)
            // ====================
            let finalNamaCustomer = null;
            const namaContactUpper = namaContact ? namaContact.toUpperCase().trim() : null;
            const namaAccountUpper = namaAccount ? namaAccount.toUpperCase().trim() : null;

            if (namaContactUpper && namaAccountUpper) {
                if (namaContactUpper === namaAccountUpper) {
                    finalNamaCustomer = namaContact;
                } else {
                    finalNamaCustomer = `${namaContact} / ${namaAccount}`;
                }
            } else if (namaContactUpper) {
                finalNamaCustomer = namaContact;
            } else if (namaAccountUpper) {
                finalNamaCustomer = namaAccount;
            }

            console.log('👨‍💼 Nama customer hasil format:', finalNamaCustomer);

            // UPDATE NAMA CUSTOMER KE DATABASE
            if (finalNamaCustomer && finalNamaCustomer.trim() !== "") {
                const currentNama = currentData.name_customer || '';
                const currentNamaClean = this.formatCustomerName(currentNama);
                const finalNamaClean = this.formatCustomerName(finalNamaCustomer).toUpperCase();

                if (currentNamaClean !== finalNamaClean) {
                    updates.name_customer = finalNamaClean;
                    console.log('✅ Akan update nama customer:', finalNamaClean);
                } else {
                    console.log('ℹ️ Nama customer sama, tidak diupdate');
                }
            } else {
                console.log('❌ Nama customer tidak valid dari CRM5');
            }

            // ====================
            // 6. UPDATE TELEPON CUSTOMER (telepon_customer)
            // ====================
            if (hpCRM && hpCRM.toString().trim() !== "") {
                const currentHp = currentData.telepon_customer || '';
                const currentHpClean = this.cleanPhoneNumber(currentHp);
                const hpCRMClean = this.cleanPhoneNumber(hpCRM);

                console.log('📱 Perbandingan nomor HP:');
                console.log('   - Database:', currentHpClean);
                console.log('   - CRM5:', hpCRMClean);
                console.log('   - Sama?', currentHpClean === hpCRMClean);

                // Update jika berbeda ATAU jika database kosong
                if (hpCRMClean !== "" && (hpCRMClean !== currentHpClean || currentHpClean === '')) {
                    updates.telepon_customer = hpCRMClean;
                    console.log('✅ Akan update telepon customer:', hpCRMClean);
                } else {
                    console.log('ℹ️ Nomor HP sama, tidak diupdate');
                }
            } else {
                console.log('❌ Nomor HP tidak valid dari CRM5:', hpCRM);
            }

            // ====================
            // 7. EKSEKUSI UPDATE KE DATABASE
            // ====================
            // Hitung perubahan (exclude timestamp fields)
            const changeFields = Object.keys(updates).filter(key =>
                                                             !['updated_at', 'mra_updated_at'].includes(key)
                                                            );
            const changesCount = changeFields.length;

            console.log('📊 Summary update:');
            console.log('   - Fields to update:', changeFields);
            console.log('   - Total changes:', changesCount);
            console.log('   - Updates data:', updates);

            if (changesCount > 0) {
                try {
                    const { data, error } = await supabase
                    .from("estimasi")
                    .update(updates)
                    .eq("id", estimasiId)
                    .select();

                    if (error) {
                        console.error('❌ Error update database:', error);
                        throw error;
                    }

                    console.log('✅ Data berhasil diupdate di database');
                    if (data && data.length > 0) {
                        console.log('📝 Data setelah update:', {
                            name_customer: data[0].name_customer,
                            telepon_customer: data[0].telepon_customer,
                            nomor_rangka: data[0].nomor_rangka
                        });
                    }

                    // Kembalikan vehicleCache untuk ditampilkan di popup
                    return { changesCount, vehicleCache };
                } catch (error) {
                    console.error('❌ Error dalam proses update:', error);
                    throw error;
                }
            } else {
                console.log('ℹ️ Tidak ada perubahan data yang diperlukan');
                return { changesCount: 0, vehicleCache };
            }
        }

        createUI() {
            document.body.innerHTML = '';
            document.body.style.margin = '0';
            document.body.style.fontFamily = 'Roboto, Arial, sans-serif';
            document.body.style.backgroundColor = '#f8f9fa';
            document.body.style.overflow = 'hidden';

            const appContainer = document.createElement('div');
            appContainer.style.minHeight = '100vh';
            appContainer.style.padding = '15px';
            appContainer.style.display = 'flex';
            appContainer.style.flexDirection = 'column';

            // Header
            const header = document.createElement('div');
            header.style.background = 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)';
            header.style.color = 'white';
            header.style.padding = '20px';
            header.style.borderRadius = '10px';
            header.style.marginBottom = '15px';
            header.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.flexShrink = '0';
            header.style.position = 'relative';

            // Di dalam createUI() method, modifikasi header
            header.innerHTML = `
    <div>
        <h1 style="margin: 0; font-size: 28px; font-weight: 600;">
            <i class="material-icons" style="vertical-align: middle; margin-right: 12px; font-size: 32px;">campaign</i>
            MRA Follow-up System
        </h1>
        <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 16px;">Design by Magenta Project</p>
    </div>
    <div style="display: flex; align-items: center; gap: 10px;">
        <button id="tab-toggle" class="btn-primary" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; font-size: 16px;">
            <i class="material-icons" style="font-size: 22px;">view_headline</i>
            Show Tabs
        </button>
        <button id="refresh-data" class="btn-primary" style="display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 16px;">
            <i class="material-icons" style="font-size: 22px;">refresh</i>
            Refresh
        </button>
    </div>
`;

            // Navigation Tabs - Tambahkan wrapper untuk kontrol height
            const tabsWrapper = document.createElement('div');
            tabsWrapper.style.position = 'relative';
            tabsWrapper.style.marginBottom = '15px';

            const tabsContainer = document.createElement('div');
            tabsContainer.style.background = 'white';
            tabsContainer.style.borderRadius = '8px';
            tabsContainer.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)';
            tabsContainer.style.display = 'flex';
            tabsContainer.style.flexShrink = '0';
            tabsContainer.style.transition = 'all 0.3s ease';
            tabsContainer.id = 'tabs-container';

            const tabs = [
                { id: 'estimasi-not-accept', name: 'Estimasi Not Accept', icon: 'pending_actions' },
                { id: 'estimasi-acc', name: 'Estimasi ACC', icon: 'check_circle' },
                { id: 'grafik-mra', name: 'Grafik MRA', icon: 'analytics' }
            ];

            tabs.forEach(tab => {
                const tabElement = document.createElement('button');
                tabElement.innerHTML = `
            <i class="material-icons" style="font-size: 22px; margin-right: 10px;">${tab.icon}</i>
            <span style="font-size: 16px;">${tab.name}</span>
        `;
                tabElement.style.padding = '18px';
                tabElement.style.fontSize = '16px';
                tabElement.style.flex = '1';
                tabElement.style.border = 'none';
                tabElement.style.background = this.currentTab === tab.id ? '#1e3c72' : 'transparent';
                tabElement.style.color = this.currentTab === tab.id ? 'white' : '#666';
                tabElement.style.cursor = 'pointer';
                tabElement.style.transition = 'all 0.2s ease';
                tabElement.style.borderRadius = '8px';
                tabElement.style.fontWeight = '500';
                tabElement.setAttribute('data-tab', tab.id);

                tabElement.onclick = () => this.switchTab(tab.id);
                tabsContainer.appendChild(tabElement);
            });

            tabsWrapper.appendChild(tabsContainer);

            // Main Content Area - Lebih tinggi karena tab hidden
            const mainContent = document.createElement('div');
            mainContent.style.flex = '1';
            mainContent.style.display = 'flex';
            mainContent.style.flexDirection = 'column';
            mainContent.style.minHeight = '0';

            // Content Container
            const contentContainer = document.createElement('div');
            contentContainer.id = 'content-container';
            contentContainer.style.background = 'white';
            contentContainer.style.borderRadius = '8px';
            contentContainer.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)';
            contentContainer.style.flex = '1';
            contentContainer.style.minHeight = '0';
            contentContainer.style.overflow = 'hidden';

            mainContent.appendChild(contentContainer);

            appContainer.appendChild(header);
            appContainer.appendChild(tabsWrapper);
            appContainer.appendChild(mainContent);
            document.body.appendChild(appContainer);

            // Attach refresh event
            document.getElementById('refresh-data').addEventListener('click', () => {
                this.loadData();
            });

            // Attach tab toggle event
            document.getElementById('tab-toggle').addEventListener('click', () => {
                this.toggleTabs();
            });

            // Auto hide tabs setelah 3 detik
            setTimeout(() => {
                this.hideTabs();
            }, 3000);

            this.renderCurrentTab();
        }

        // Method untuk render section foto
        renderFotoSection(estimasi) {
            if (!estimasi.foto_url) {
                return '';
            }

            let fotoUrls = [];
            try {
                if (typeof estimasi.foto_url === 'string') {
                    fotoUrls = JSON.parse(estimasi.foto_url);
                } else if (Array.isArray(estimasi.foto_url)) {
                    fotoUrls = estimasi.foto_url;
                }
            } catch (e) {
                console.error('Error parsing foto_url:', e);
                return '';
            }

            if (fotoUrls.length === 0) {
                return '';
            }

            return `
        <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #1e3c72;">photo_library</i>
                    Foto Estimasi (${fotoUrls.length})
                </h4>
                <div style="display: flex; gap: 8px;">
                    <button id="prev-foto" class="btn-small" style="display: flex; align-items: center; gap: 4px; padding: 6px 10px; font-size: 12px;">
                        <i class="material-icons" style="font-size: 16px;">chevron_left</i>
                        Prev
                    </button>
                    <button id="next-foto" class="btn-small" style="display: flex; align-items: center; gap: 4px; padding: 6px 10px; font-size: 12px;">
                        Next
                        <i class="material-icons" style="font-size: 16px;">chevron_right</i>
                    </button>
                    <button id="download-all-fotos" class="btn-primary" style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px;">
                        <i class="material-icons" style="font-size: 16px;">download</i>
                        Download All
                    </button>
                </div>
            </div>

            <!-- Container foto dengan fixed width dan overflow -->
            <div style="position: relative; width: 100%;">
                <div id="foto-scroll-container"
     style="
        display: flex;
        gap: 12px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 10px 5px;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;

        /* ❗ Fixed hanya 4 foto yang terlihat */
        max-width: calc((150px * 4) + (12px * 3));

        box-sizing: border-box;
     ">

                    ${fotoUrls.map((url, index) => `
                        <div style="flex: 0 0 auto;
                                   position: relative;
                                   cursor: pointer;
                                   width: 150px;
                                   height: 100px;"
                             class="foto-thumbnail">
                            <img src="${url}"
                                 alt="Foto estimasi ${index + 1}"
                                 style="width: 100%;
                                        height: 100%;
                                        object-fit: cover;
                                        border-radius: 6px;
                                        border: 2px solid #e0e0e0;
                                        transition: all 0.2s ease;"
                                 onclick="window.open('${url}', '_blank')">
                            <div style="position: absolute;
                                       top: 5px;
                                       right: 5px;
                                       background: rgba(0,0,0,0.7);
                                       color: white;
                                       padding: 2px 6px;
                                       border-radius: 10px;
                                       font-size: 10px;
                                       font-weight: bold;">
                                ${index + 1}
                            </div>
                            <div style="position: absolute;
                                       bottom: 5px;
                                       left: 5px;
                                       background: rgba(0,0,0,0.7);
                                       color: white;
                                       padding: 2px 6px;
                                       border-radius: 10px;
                                       font-size: 10px;">
                                <i class="material-icons" style="font-size: 12px; vertical-align: middle;">zoom_in</i>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- Gradient overlay untuk indikasi ada lebih banyak foto -->
                <div style="position: absolute;
                           top: 0;
                           right: 0;
                           bottom: 0;
                           width: 30px;
                           background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9));
                           pointer-events: none;
                           display: ${fotoUrls.length > 3 ? 'block' : 'none'};">
                </div>
                <div style="position: absolute;
                           top: 0;
                           left: 0;
                           bottom: 0;
                           width: 30px;
                           background: linear-gradient(270deg, transparent, rgba(255,255,255,0.9));
                           pointer-events: none;
                           display: none;"
                     id="left-gradient">
                </div>
            </div>

            <!-- Indikator scroll -->
            <div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 10px;">
                <span style="font-size: 12px; color: #666;">
                    ${fotoUrls.length > 3 ? 'Scroll untuk melihat lebih banyak foto' : `${fotoUrls.length} foto tersedia`}
                </span>
                ${fotoUrls.length > 3 ? '<i class="material-icons" style="font-size: 16px; color: #666;">swap_horiz</i>' : ''}
            </div>
        </div>
    `;
        }

        // Download satu foto (Cloudinary/Supabase safe)
        downloadFoto(url, filename) {
            fetch(url, {
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Accept': 'image/*'
                }
            })
                .then(response => {
                if (!response.ok) {
                    throw new Error('Tidak dapat mengambil file: ' + response.status);
                }
                return response.blob();
            })
                .then(blob => {
                const blobUrl = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename || 'foto_estimasi.jpg';
                a.style.display = 'none';

                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            })
                .catch(err => {
                console.error('Error downloading image:', err);
                this.showNotification('Gagal mengunduh foto', 'error');
            });
        }

        // Download semua foto satu per satu
        downloadAllFotos(fotoUrls) {
            if (!fotoUrls || fotoUrls.length === 0) {
                this.showNotification('Tidak ada foto untuk diunduh', 'warning');
                return;
            }

            fotoUrls.forEach((url, index) => {
                setTimeout(() => {
                    this.downloadFoto(url, `foto_estimasi_${index + 1}.jpg`);
                }, index * 300); // Cloudinary cepat, cukup 300ms
            });

            this.showNotification(`Mengunduh ${fotoUrls.length} foto...`, 'info');
        }

        // Method baru untuk handle events foto
        attachFotoEvents() {
            // Prev/Next foto navigation
            const prevBtn = document.getElementById('prev-foto');
            const nextBtn = document.getElementById('next-foto');
            const fotoContainer = document.getElementById('foto-scroll-container');
            const leftGradient = document.getElementById('left-gradient');

            if (prevBtn && fotoContainer) {
                prevBtn.addEventListener('click', () => {
                    fotoContainer.scrollBy({
                        left: -200,
                        behavior: 'smooth'
                    });
                });
            }

            if (nextBtn && fotoContainer) {
                nextBtn.addEventListener('click', () => {
                    fotoContainer.scrollBy({
                        left: 200,
                        behavior: 'smooth'
                    });
                });
            }

            // Scroll detection untuk show/hide gradient
            if (fotoContainer) {
                fotoContainer.addEventListener('scroll', () => {
                    if (leftGradient) {
                        // Show left gradient jika tidak di posisi awal
                        if (fotoContainer.scrollLeft > 10) {
                            leftGradient.style.display = 'block';
                        } else {
                            leftGradient.style.display = 'none';
                        }
                    }
                });

                // Trigger scroll event sekali untuk set initial state
                setTimeout(() => {
                    fotoContainer.dispatchEvent(new Event('scroll'));
                }, 100);
            }

            // Download all foto
            const downloadAllFotosBtn = document.getElementById('download-all-fotos');
            if (downloadAllFotosBtn && this.currentDetail && this.currentDetail.foto_url) {
                downloadAllFotosBtn.addEventListener('click', () => {
                    let fotoUrls = [];
                    try {
                        if (typeof this.currentDetail.foto_url === 'string') {
                            fotoUrls = JSON.parse(this.currentDetail.foto_url);
                        } else if (Array.isArray(this.currentDetail.foto_url)) {
                            fotoUrls = this.currentDetail.foto_url;
                        }
                    } catch (e) {
                        console.error('Error parsing foto_url:', e);
                    }

                    if (fotoUrls.length > 0) {
                        this.downloadAllFotos(fotoUrls);
                    } else {
                        this.showNotification('Tidak ada foto untuk diunduh', 'warning');
                    }
                });
            }

            // Hover effect untuk foto
            document.querySelectorAll('.foto-thumbnail').forEach(thumbnail => {
                thumbnail.addEventListener('mouseenter', () => {
                    thumbnail.style.transform = 'scale(1.05)';
                    thumbnail.style.zIndex = '10';
                });
                thumbnail.addEventListener('mouseleave', () => {
                    thumbnail.style.transform = 'scale(1)';
                    thumbnail.style.zIndex = '1';
                });
            });
        }

        showManualDiskonModal() {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            const spareparts = this.parseSpareparts(this.currentDetail);
            const services = this.parseServices(this.currentDetail);

            const styles = `
<style>
/* Overlay */
.ios-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.35);
    backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000;
}

/* Modal */
.ios-modal {
    background: #fff;
    border-radius: 16px;
    width: 92%;
    max-width: 780px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}

/* Header */
.ios-header {
    padding: 14px 18px;
    border-bottom: 1px solid #e6e6e6;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fafafa;
}
.ios-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
}
.ios-close-btn {
    background: none;
    border: none;
    padding: 5px;
    cursor: pointer;
    border-radius: 8px;
    color: #666;
    transition: background 0.2s;
}
.ios-close-btn:hover {
    background: rgba(0,0,0,0.08);
}

/* Content */
.ios-content {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
}

/* 2 kolom */
.ios-two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px;
}
@media (max-width: 768px) {
    .ios-two-column {
        grid-template-columns: 1fr;
    }
}

/* Section title */
.ios-section-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #eee;
    font-size: 14px;
    font-weight: 600;
}

/* Reset button */
.btn-reset {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 6px;
    background: #ff9500;
    color: white;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
}
.btn-reset:hover {
    background: #e68500;
}

/* Bulk box */
.ios-bulk-controls {
    background: #f8f8f8;
    border: 1px solid #e3e3e3;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
}

.ios-bulk-input-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.ios-bulk-label {
    font-size: 13px;
    font-weight: 500;
    min-width: 120px;
}

/* Bulk Input */
.ios-input {
    padding: 6px 10px;
    font-size: 13px;
    height: 36px;
    border-radius: 8px;
    border: 1px solid #bbb;
    width: 60px;
    text-align: center;
}

/* Individual item styling */
.ios-item {
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 10px;
    background: #fff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s ease;
}
.ios-item:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}
.ios-item.active {
    border-color: #ff9f0a;
    background: #fff7e0;
}

/* Item info */
.item-info {
    flex: 1;
    margin-right: 12px;
    min-width: 0;
}
.item-name {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 3px;
    color: #1c1c1e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.item-details {
    font-size: 12px;
    color: #666;
    margin-bottom: 4px;
}
.item-price {
    font-size: 13px;
    color: #34c759;
    font-weight: 500;
}

/* Input group for individual items */
.ios-input-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 140px;
    justify-content: flex-end;
}

/* Individual input */
.manual-diskon-input {
    width: 65px !important;
    height: 34px;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid #bbb;
    font-size: 13px;
    text-align: center;
    box-sizing: border-box;
}
.manual-diskon-input:focus {
    outline: none;
    border-color: #007aff;
    box-shadow: 0 0 0 2px rgba(0,122,255,0.2);
}

/* Buttons */
.ios-btn-small {
    padding: 6px 10px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 45px;
    height: 34px;
    box-sizing: border-box;
}
.ios-btn-small:hover {
    transform: translateY(-1px);
}

.btn-bulk {
    background: #007aff;
    color: #fff;
}
.btn-bulk:hover {
    background: #0056cc;
}

.btn-apply {
    background: #34c759;
    color: #fff;
}
.btn-apply:hover {
    background: #2e9e4a;
}

.btn-remove {
    background: #ff3b30;
    color: #fff;
    padding: 6px 8px !important;
    min-width: 34px !important;
}
.btn-remove:hover {
    background: #d32f2f;
}

/* Footer */
.ios-footer {
    padding: 14px 16px;
    border-top: 1px solid #e6e6e6;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fafafa;
}

.ios-footer-btn {
    padding: 8px 16px;
    font-size: 14px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
}

.btn-primary-ios {
    background: #007aff;
    color: #fff;
}
.btn-primary-ios:hover {
    background: #0056cc;
}

.btn-secondary-ios {
    background: #8e8e93;
    color: #fff;
}
.btn-secondary-ios:hover {
    background: #6c6c70;
}

/* Scrollbar */
.ios-scroll-area::-webkit-scrollbar {
    width: 6px;
}
.ios-scroll-area::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
}
.ios-scroll-area::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
}
</style>
`;

            let modalHtml = `
    ${styles}
    <div id="manual-diskon-modal" class="ios-overlay">
        <div class="ios-modal">
            <div class="ios-header">
                <h3 class="ios-title">
                    <i class="material-icons" style="margin-right: 8px; color: #ff9f0a;">edit</i>
                    Edit Diskon Manual
                </h3>
                <button id="close-manual-diskon-modal" class="ios-close-btn">
                    <i class="material-icons" style="font-size: 20px;">close</i>
                </button>
            </div>

            <div class="ios-content ios-scroll-area">
                <div class="ios-two-column">
    `;

            // --- Panel Sparepart ---
            if (spareparts.length > 0) {
                modalHtml += `
            <div>
                <h4 class="ios-section-title">
                    <span>Sparepart (${spareparts.length})</span>
                    <button id="reset-all-sparepart" class="btn-reset">
                        Reset All
                    </button>
                </h4>

                <!-- Bulk Controls untuk Sparepart -->
                <div class="ios-bulk-controls">
                    <div class="ios-bulk-input-group">
                        <span class="ios-bulk-label">Diskon Semua Sparepart:</span>
                        <input type="number"
                               id="bulk-diskon-sparepart"
                               class="ios-input"
                               placeholder="0%"
                               min="0"
                               max="100">
                        <button id="apply-bulk-sparepart" class="ios-btn-small btn-bulk">
                            Terapkan
                        </button>
                        <button id="remove-bulk-sparepart" class="ios-btn-small btn-remove">
                            Hapus
                        </button>
                    </div>
                </div>

                <div>
        `;

                spareparts.forEach((part, index) => {
                    const diskonManual = this.diskonSettings.manualSparepart[index] || '';
                    const hargaNormal = (part.price || 0) * (part.qty || 1);
                    const diskonAktif = diskonManual || this.diskonSettings.sparepart;
                    const hargaSetelahDiskon = hargaNormal * (1 - (diskonAktif || 0) / 100);

                    modalHtml += `
                <div class="ios-item ${diskonManual ? 'active' : ''}">
                    <div class="item-info">
                        <div class="item-name">${part.name || 'Sparepart'}</div>
                        <div class="item-details">${part.qty || 1} × Rp ${(part.price || 0).toLocaleString('id-ID')}</div>
                        <div class="item-price">
                            Rp ${Math.round(hargaSetelahDiskon).toLocaleString('id-ID')}
                            ${diskonAktif > 0 ? `<span style="background: rgba(52, 199, 89, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: 5px; font-size: 11px;">-${diskonAktif}%</span>` : ''}
                        </div>
                    </div>

                    <div class="ios-input-group">
                        <input type="number"
                               class="manual-diskon-input"
                               data-type="sparepart"
                               data-index="${index}"
                               value="${diskonManual}"
                               placeholder="0%"
                               min="0"
                               max="100"
                               step="0.1">
                        <button class="ios-btn-small btn-apply btn-apply-manual-diskon"
                                data-type="sparepart"
                                data-index="${index}">
                            Set
                        </button>
                        ${diskonManual !== '' ? `
                            <button class="ios-btn-small btn-remove btn-remove-manual-diskon"
                                    data-type="sparepart"
                                    data-index="${index}">
                                ×
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
                });

                modalHtml += `
                </div>
            </div>
        `;
            }

            // --- Panel Jasa ---
            if (services.length > 0) {
                modalHtml += `
            <div>
                <h4 class="ios-section-title">
                    <span>Jasa (${services.length})</span>
                    <button id="reset-all-jasa" class="btn-reset">
                        Reset All
                    </button>
                </h4>

                <!-- Bulk Controls untuk Jasa -->
                <div class="ios-bulk-controls">
                    <div class="ios-bulk-input-group">
                        <span class="ios-bulk-label">Diskon Semua Jasa:</span>
                        <input type="number"
                               id="bulk-diskon-jasa"
                               class="ios-input"
                               placeholder="0%"
                               min="0"
                               max="100">
                        <button id="apply-bulk-jasa" class="ios-btn-small btn-bulk">
                            Terapkan
                        </button>
                        <button id="remove-bulk-jasa" class="ios-btn-small btn-remove">
                            Hapus
                        </button>
                    </div>
                </div>

                <div>
        `;

                services.forEach((service, index) => {
                    const diskonManual = this.diskonSettings.manualJasa[index] || '';
                    const hargaNormal = (service.price || 0) * (service.hour || 1);
                    const diskonAktif = diskonManual || this.diskonSettings.jasa;
                    const hargaSetelahDiskon = hargaNormal * (1 - (diskonAktif || 0) / 100);

                    modalHtml += `
                <div class="ios-item ${diskonManual ? 'active' : ''}">
                    <div class="item-info">
                        <div class="item-name">${service.name || 'Jasa'}</div>
                        <div class="item-details">${service.hour || 1} jam × Rp ${(service.price || 0).toLocaleString('id-ID')}</div>
                        <div class="item-price">
                            Rp ${Math.round(hargaSetelahDiskon).toLocaleString('id-ID')}
                            ${diskonAktif > 0 ? `<span style="background: rgba(52, 199, 89, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: 5px; font-size: 11px;">-${diskonAktif}%</span>` : ''}
                        </div>
                    </div>

                    <div class="ios-input-group">
                        <input type="number"
                               class="manual-diskon-input"
                               data-type="jasa"
                               data-index="${index}"
                               value="${diskonManual}"
                               placeholder="0%"
                               min="0"
                               max="100"
                               step="0.1">
                        <button class="ios-btn-small btn-apply btn-apply-manual-diskon"
                                data-type="jasa"
                                data-index="${index}">
                            Set
                        </button>
                        ${diskonManual !== '' ? `
                            <button class="ios-btn-small btn-remove btn-remove-manual-diskon"
                                    data-type="jasa"
                                    data-index="${index}">
                                ×
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
                });

                modalHtml += `
                </div>
            </div>
        `;
            }

            modalHtml += `
                </div>
            </div>
            <div class="ios-footer">
                <div style="font-size: 13px; color: #8e8e93; display: flex; align-items: center;">
                    <i class="material-icons" style="font-size: 16px; margin-right: 5px; color: #ff9f0a;">info</i>
                    Override diskon global
                </div>
                <div style="display: flex; gap: 12px;">
                    <button id="close-modal" class="ios-footer-btn btn-secondary-ios">
                        Batal
                    </button>
                    <button id="apply-all-manual-diskon" class="ios-footer-btn btn-primary-ios">
                        Simpan Perubahan
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;

            // Hapus modal sebelumnya jika ada
            const existingModal = document.getElementById('manual-diskon-modal');
            if (existingModal) {
                existingModal.remove();
            }

            // Tambahkan modal baru
            const modalDiv = document.createElement('div');
            modalDiv.innerHTML = modalHtml;
            document.body.appendChild(modalDiv);

            // Attach events untuk modal
            this.attachManualDiskonModalEvents();
        }

        // Method untuk attach events modal diskon manual (FIXED VERSION)
        attachManualDiskonModalEvents() {
            const modalOverlay = document.getElementById('manual-diskon-modal');
            if (!modalOverlay) return;

            // Fungsi tutup modal
            const closeModal = () => {
                modalOverlay.remove();
            };

            // Fungsi refresh modal
            const refreshModal = () => {
                closeModal();
                this.showManualDiskonModal();
            };

            // Event delegation untuk semua tombol dalam modal
            modalOverlay.addEventListener('click', (e) => {
                const target = e.target;
                const button = target.closest('button');

                if (!button) return;

                // 1. Tombol Close
                if (button.id === 'close-manual-diskon-modal' || button.id === 'close-modal') {
                    closeModal();
                    return;
                }

                // 2. Reset All Sparepart
                if (button.id === 'reset-all-sparepart') {
                    this.diskonSettings.manualSparepart = {};
                    this.showNotification('Diskon sparepart direset', 'info');
                    refreshModal();
                    return;
                }

                // 3. Reset All Jasa
                if (button.id === 'reset-all-jasa') {
                    this.diskonSettings.manualJasa = {};
                    this.showNotification('Diskon jasa direset', 'info');
                    refreshModal();
                    return;
                }

                // 4. Apply Bulk Sparepart
                if (button.id === 'apply-bulk-sparepart') {
                    const input = document.getElementById('bulk-diskon-sparepart');
                    const value = parseFloat(input.value) || 0;

                    if (value >= 0 && value <= 100) {
                        this.applyBulkDiskon('sparepart', value);
                        this.showNotification(`Diskon ${value}% diterapkan ke semua sparepart`, 'success');
                        refreshModal();
                    } else {
                        this.showNotification('Diskon harus antara 0-100%', 'error');
                    }
                    return;
                }

                // 5. Remove Bulk Sparepart
                if (button.id === 'remove-bulk-sparepart') {
                    this.removeBulkDiskon('sparepart');
                    this.showNotification('Diskon sparepart dihapus', 'info');
                    refreshModal();
                    return;
                }

                // 6. Apply Bulk Jasa
                if (button.id === 'apply-bulk-jasa') {
                    const input = document.getElementById('bulk-diskon-jasa');
                    const value = parseFloat(input.value) || 0;

                    if (value >= 0 && value <= 100) {
                        this.applyBulkDiskon('jasa', value);
                        this.showNotification(`Diskon ${value}% diterapkan ke semua jasa`, 'success');
                        refreshModal();
                    } else {
                        this.showNotification('Diskon harus antara 0-100%', 'error');
                    }
                    return;
                }

                // 7. Remove Bulk Jasa
                if (button.id === 'remove-bulk-jasa') {
                    this.removeBulkDiskon('jasa');
                    this.showNotification('Diskon jasa dihapus', 'info');
                    refreshModal();
                    return;
                }

                // 8. Apply Individual Diskon
                if (button.classList.contains('btn-apply-manual-diskon')) {
                    const type = button.dataset.type;
                    const index = parseInt(button.dataset.index);
                    const input = document.querySelector(`.manual-diskon-input[data-type="${type}"][data-index="${index}"]`);
                    const value = parseFloat(input.value) || 0;

                    if (value >= 0 && value <= 100) {
                        this.applyManualDiskon(type, index, value);
                        this.showNotification(`Diskon ${value}% diset untuk ${type}`, 'success');
                        refreshModal();
                    } else {
                        this.showNotification('Diskon harus antara 0-100%', 'error');
                    }
                    return;
                }

                // 9. Remove Individual Diskon
                if (button.classList.contains('btn-remove-manual-diskon')) {
                    const type = button.dataset.type;
                    const index = parseInt(button.dataset.index);

                    this.applyManualDiskon(type, index, '');
                    this.showNotification(`Diskon manual dihapus untuk ${type}`, 'info');
                    refreshModal();
                    return;
                }

                // 10. Apply All Changes
                if (button.id === 'apply-all-manual-diskon') {
                    this.showNotification('Perubahan diskon manual diterapkan', 'success');
                    closeModal();
                    // Refresh tampilan utama
                    if (typeof this.renderCurrentTab === 'function') {
                        this.renderCurrentTab();
                    }
                    return;
                }
            });

            // Support Enter key untuk bulk inputs
            modalOverlay.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const target = e.target;

                    if (target.id === 'bulk-diskon-sparepart') {
                        document.getElementById('apply-bulk-sparepart').click();
                    } else if (target.id === 'bulk-diskon-jasa') {
                        document.getElementById('apply-bulk-jasa').click();
                    }
                }
            });

            // Juga tambahkan event untuk input individual dengan Enter
            modalOverlay.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.target.classList.contains('manual-diskon-input')) {
                    const type = e.target.dataset.type;
                    const index = e.target.dataset.index;
                    const btn = document.querySelector(`.btn-apply-manual-diskon[data-type="${type}"][data-index="${index}"]`);
                    if (btn) btn.click();
                }
            });
        }

        // Method applyBulkDiskon yang sudah diperbaiki
        applyBulkDiskon(type, value) {
            const diskonValue = Math.max(0, Math.min(100, Number(value) || 0));

            // Pastikan diskonSettings ada dan menggunakan OBJECT
            if (!this.diskonSettings) {
                this.diskonSettings = {
                    manualSparepart: {},
                    manualJasa: {}
                };
            }

            if (type === 'sparepart') {
                const spareparts = this.parseSpareparts(this.currentDetail) || [];
                // Reset dulu lalu set semua dengan nilai yang sama menggunakan OBJECT
                this.diskonSettings.manualSparepart = {};
                spareparts.forEach((_, index) => {
                    this.diskonSettings.manualSparepart[index] = diskonValue;
                });
            } else if (type === 'jasa') {
                const services = this.parseServices(this.currentDetail) || [];
                // Reset dulu lalu set semua dengan nilai yang sama menggunakan OBJECT
                this.diskonSettings.manualJasa = {};
                services.forEach((_, index) => {
                    this.diskonSettings.manualJasa[index] = diskonValue;
                });
            }

            // Update perhitungan total
            if (this.calculateEstimasiTotal) {
                this.calculateEstimasiTotal();
            }
        }

        removeBulkDiskon(type) {
            // Pastikan diskonSettings ada
            if (!this.diskonSettings) {
                this.diskonSettings = {
                    manualSparepart: {},
                    manualJasa: {}
                };
            }

            if (type === 'sparepart') {
                this.diskonSettings.manualSparepart = {};
                // Reset input value
                const bulkInput = document.getElementById('bulk-diskon-sparepart');
                if (bulkInput) bulkInput.value = '';
            } else if (type === 'jasa') {
                this.diskonSettings.manualJasa = {};
                // Reset input value
                const bulkInput = document.getElementById('bulk-diskon-jasa');
                if (bulkInput) bulkInput.value = '';
            }

            // Update perhitungan total
            if (this.calculateEstimasiTotal) {
                this.calculateEstimasiTotal();
            }
        }

        applyManualDiskon(type, index, value) {
            // Pastikan diskonSettings ada
            if (!this.diskonSettings) {
                this.diskonSettings = {
                    manualSparepart: {},
                    manualJasa: {}
                };
            }

            // Pastikan objek manual ada
            if (type === 'sparepart' && !this.diskonSettings.manualSparepart) {
                this.diskonSettings.manualSparepart = {};
            } else if (type === 'jasa' && !this.diskonSettings.manualJasa) {
                this.diskonSettings.manualJasa = {};
            }

            // Handle value (bisa number atau string kosong untuk hapus)
            if (value === '' || value === null || value === undefined) {
                // Hapus diskon manual
                if (type === 'sparepart') {
                    delete this.diskonSettings.manualSparepart[index];
                } else if (type === 'jasa') {
                    delete this.diskonSettings.manualJasa[index];
                }
            } else {
                // Set diskon manual
                const diskonValue = Math.max(0, Math.min(100, Number(value)));
                if (type === 'sparepart') {
                    this.diskonSettings.manualSparepart[index] = diskonValue;
                } else if (type === 'jasa') {
                    this.diskonSettings.manualJasa[index] = diskonValue;
                }
            }

            // Update perhitungan total
            if (this.calculateEstimasiTotal) {
                this.calculateEstimasiTotal();
            }
        }

        closeManualDiskonModal() {
            const modal = document.getElementById('manual-diskon-modal');
            if (modal) {
                document.body.removeChild(modal);
            }
        }

        parseSpareparts(estimasi) {
            if (!estimasi.sparepart_data) return [];
            try {
                const spareparts = typeof estimasi.sparepart_data === 'string'
                ? JSON.parse(estimasi.sparepart_data)
                : estimasi.sparepart_data;
                return Array.isArray(spareparts) ? spareparts : [];
            } catch (e) {
                return [];
            }
        }

        parseServices(estimasi) {
            if (!estimasi.service_data) return [];
            try {
                const services = typeof estimasi.service_data === 'string'
                ? JSON.parse(estimasi.service_data)
                : estimasi.service_data;
                return Array.isArray(services) ? services : [];
            } catch (e) {
                return [];
            }
        }

        showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        transition: all 0.3s ease;
        max-width: 350px;
        font-size: 14px;
    `;

            const colors = {
                success: '#4caf50',
                error: '#f44336',
                info: '#2196f3',
                warning: '#ff9800'
            };

            notification.style.background = colors[type] || colors.info;
            notification.textContent = message;

            document.body.appendChild(notification);

            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }, 3000);
        }

        // Method untuk toggle tabs
        toggleTabs() {
            const tabsContainer = document.getElementById('tabs-container');
            const toggleButton = document.getElementById('tab-toggle');

            if (tabsContainer.classList.contains('tabs-hidden')) {
                this.showTabs();
            } else {
                this.hideTabs();
            }
        }

        hideTabs() {
            const tabsContainer = document.getElementById('tabs-container');
            const toggleButton = document.getElementById('tab-toggle');

            tabsContainer.classList.add('tabs-hidden');
            toggleButton.innerHTML = '<i class="material-icons" style="font-size: 16px; margin-right: 5px;">keyboard_arrow_up</i> Show Tabs';
        }

        showTabs() {
            const tabsContainer = document.getElementById('tabs-container');
            const toggleButton = document.getElementById('tab-toggle');

            tabsContainer.classList.remove('tabs-hidden');
            toggleButton.innerHTML = '<i class="material-icons" style="font-size: 16px; margin-right: 5px;">keyboard_arrow_down</i> Hide Tabs';
        }

        switchTab(tabId) {
            // Reset focus state sebelum switch
            this.lastFocusedElement = null;

            this.currentTab = tabId;

            document.querySelectorAll('#tabs-container button').forEach(tab => {
                const isActive = tab.getAttribute('data-tab') === tabId;
                tab.style.background = isActive ? '#1e3c72' : 'transparent';
                tab.style.color = isActive ? 'white' : '#666';
            });

            this.renderCurrentTab();
        }

        renderCurrentTab() {
            const container = document.getElementById('content-container');

            switch(this.currentTab) {
                case 'estimasi-not-accept':
                    this.renderEstimasiNotAccept(container);
                    break;
                case 'estimasi-acc':
                    this.renderEstimasiACC(container);
                    break;
                case 'grafik-mra':
                    this.renderGrafikMRA(container);
                    break;
            }
        }

        async loadData() {
            try {
                console.log('🔄 Starting loadData...');
                this.showNotification('Memuat data...', 'info');

                const { data: estimasiData, error: estimasiError } = await supabase
                .from('estimasi')
                .select(`
                *,
                users:teknisi_id (full_name, email)
            `)
                .order('created_at', { ascending: false });

                if (estimasiError) throw estimasiError;

                console.log('📥 Data loaded from Supabase:', estimasiData.length);

                this.estimasiData = estimasiData.map(estimasi => ({
                    ...estimasi,
                    teknisi_name: estimasi.users?.full_name || '-'
                }));

                // ✅ SIMPAN DATA ASLI TANPA FILTER
                this.originalData = [...this.estimasiData];

                // ✅ UBAH: Default tampil SEMUA DATA, bukan hanya completed
                this.filteredData = [...this.originalData];

                console.log('✅ Data processing completed');
                console.log('📊 Total originalData:', this.originalData.length);
                console.log('📊 Total filteredData:', this.filteredData.length);

                // AUTO SELECT: Pilih estimasi pertama jika ada data
                if (this.filteredData.length > 0 && !this.currentDetail) {
                    this.selectedId = this.filteredData[0].id;
                    this.currentDetail = this.filteredData[0];
                    currentEstimasiId = this.filteredData[0].id;
                    this.customerDetail = null;
                    console.log('🎯 Auto-selected first item:', this.filteredData[0].nopol);
                }

                this.renderCurrentTab();
                this.showNotification('Data berhasil dimuat!', 'success');

            } catch (error) {
                console.error('❌ Error loading data:', error);
                this.showNotification('Error loading data: ' + error.message, 'error');
            }
        }

        renderEstimasiNotAccept(container) {
            const notAcceptData = this.filteredData;

            const searchValue = this.searchState.term || '';
            const showAllMode = this.searchState.showAll;
            container.innerHTML = `
<style>
/* ✅ TOMBOL CUSTOM */
.btn-small {
    background: #e9ecef;
    color: #495057;
    border: none;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
}

.btn-small:hover {
    background: #dee2e6;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* Tombol aktif */
.btn-small.active {
    background: #1e3c72;
    color: white;
}
/* Pastikan input bisa diketik */
#search-not-accept, #date-filter-not-accept {
    pointer-events: auto !important;
    opacity: 1 !important;
    background: white !important;
    color: #333 !important;
}

/* Hilangkan style yang mungkin memblokir input */
input[type="text"], input[type="date"], input[type="number"] {
    -webkit-user-select: text !important;
    -moz-user-select: text !important;
    -ms-user-select: text !important;
    user-select: text !important;
}
/* Style untuk marking kelengkapan */
.completeness-marker {
    transition: all 0.3s ease;
}

.completeness-marker:hover {
    transform: scale(1.1);
}

/* Tooltip styling */
[tooltip] {
    position: relative;
}

[tooltip]:hover::after {
    content: attr(tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    z-index: 1000;
}

[tooltip]:hover::before {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #333;
    margin-bottom: -5px;
}
.workorder-item:hover {
    background: #f8f9fa !important;
    border-color: #2196f3 !important;
}

.workorder-item.active {
    background: #e3f2fd !important;
    border-color: #2196f3 !important;
}

.btn-open-workorder {
    background: #4caf50 !important;
    color: white !important;
    border: none !important;
}

.btn-open-workorder:hover {
    background: #45a049 !important;
    transform: translateY(-1px) !important;
}

/* Tambahkan di CSS style */
@keyframes slideInRight {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

@keyframes slideOutRight {
    from {
        transform: translateX(0);
        opacity: 1;
    }
    to {
        transform: translateX(100%);
        opacity: 0;
    }
}
.edit-template-btn {
    width: 32px !important;
    min-width: 32px !important;
    height: auto !important;
    padding: 6px !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    transition: all 0.3s ease !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    border: none !important;
}

.edit-template-btn:hover {
    background: #f57c00 !important;
    transform: scale(1.05) !important;
}

.template-btn-container {
    display: flex !important;
    gap: 4px !important;
    align-items: stretch !important;
}
/* Tambahkan di CSS style */
.template-btn {
    padding: 10px 8px !important;
    font-size: 12px !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    transition: all 0.3s ease !important;
    text-align: center !important;
    font-weight: 500 !important;
    border: 1px solid #ddd !important;
    background: #f8f9fa !important;
    color: #495057 !important;
}

.template-btn:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
}

.template-btn.active {
    background: #1976d2 !important;
    color: white !important;
    border-color: #1976d2 !important;
    box-shadow: 0 2px 6px rgba(25, 118, 210, 0.4) !important;
}

#whatsapp-template-display {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
}
/* Tambahkan di CSS style */
.tabs-hidden {
    height: 0 !important;
    overflow: hidden !important;
    margin-bottom: 0 !important;
}

/* Tambahkan di CSS style */
.btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.material-icons.autorenew {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.tab-toggle {
    position: absolute;
    top: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: #1e3c72;
    color: white;
    border: none;
    border-radius: 20px 20px 0 0;
    padding: 5px 20px;
    cursor: pointer;
    font-size: 12px;
    z-index: 100;
    transition: all 0.3s ease;
}

.tab-toggle:hover {
    background: #2a5298;
}
input:not([type="checkbox"]),
textarea,
select {
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 100% !important;
}


.btn-large {
background: linear-gradient(135deg,#1976d2,#42a5f5) !important;
border: none !important;
color: white !important;
padding: 10px 14px !important;
border-radius: 8px !important;
cursor: pointer !important;
display: flex !important;
align-items: center !important;
justify-content: center !important;
transition: 0.2s !important;
box-shadow: 0 3px 6px rgba(0,0,0,0.22) !important;
}
.btn-large:hover {
background: linear-gradient(135deg,#2196f3,#64b5f6) !important;
}


.colored-icon {
background: linear-gradient(45deg,#1976d2,#7e57c2,#ef5350);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
font-weight: bold;
}


.panel-colored {
background: linear-gradient(135deg,#f0f6ff,#fff7f0) !important;
border: 1px solid #c5dbff !important;
box-shadow: 0 3px 8px #0001 !important;
}


#wa-template-header {
position: sticky;
top: 0;
z-index: 10;
background: linear-gradient(90deg,#f0f6ff,#e8f5e9,#fff3e0);
padding-bottom: 10px;
border-bottom: 2px solid #b3c7ff;
}


input, textarea {
border-radius: 8px !important;
border: 1px solid #aac7ff !important;
padding: 12px !important;
}


#detail-content-left, #detail-content-right {
overflow-wrap: break-word !important;
word-break: break-word !important;
}
</style>
<div style="display: flex; height: 100%; gap: 15px;">

    <!-- Daftar Estimasi -->
    <div style="flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; max-height: 80vh;">
        <div style="padding: 20px; border-bottom: 1px solid #c5dbff; flex-shrink: 0; background:#f0f6ff;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #0b3d91; font-size: 18px; font-weight: 600;">
                    <i class="material-icons colored-icon"
                       style="vertical-align: middle; margin-right: 8px; font-size: 20px;">list</i>
                    List
                    <span style="font-size: 14px; color: #666;">
                        (${showAllMode ? 'All' : 'Complete'}: ${notAcceptData.length})
                    </span>
                </h3>
                <div style="display: flex; gap: 8px;">
                    <!-- ✅ TOMBOL TOGGLE SHOW ALL - PERBAIKI TEKS -->
                    <button id="toggle-show-all" class="btn-small"
                            style="background: ${showAllMode ? '#4caf50' : '#ff9800'}; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center;">
                        <i class="material-icons" style="font-size: 16px; margin-right: 4px;">
                            ${showAllMode ? 'check_circle' : 'filter_list'}
                        </i>
                        ${showAllMode ? 'Complete' : 'All'}
                    </button>
                    <!-- ✅ TOMBOL RESET FILTER -->
                    <button id="reset-filters" class="btn-small" style="background: #f44336; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center;">
                        <i class="material-icons" style="font-size: 16px; margin-right: 4px;">refresh</i>
                    </button>
                </div>
            </div>

            <div style="position: relative; width: 100%; margin-bottom: 12px;">
                <input type="text" id="search-not-accept"
                       value="${searchValue}"
                       placeholder="Cari nopol, customer, atau mobil..."
                    style="width: 100%; padding: 12px 35px 12px 12px; border: 1px solid #aac7ff; border-radius: 6px;">
                <i class="material-icons colored-icon"
                   style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 20px;">search</i>
            </div>

            <div style="margin-bottom: 8px;">
                <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #0b3d91;">Filter Tanggal</label>
                <input type="date" id="date-filter-not-accept"
                       value="${this.searchState.date || ''}"
                    style="width: 100%; padding: 12px; border: 1px solid #aac7ff; border-radius: 6px;">
            </div>

            <!-- ✅ INDIKATOR FILTER AKTIF -->
            ${this.searchState.term || !this.searchState.showAll ? `
                <div style="background: #e3f2fd; padding: 8px 12px; border-radius: 6px; border-left: 4px solid #2196f3; margin-top: 8px;">
                    <div style="font-size: 12px; color: #0b3d91;">
                        <i class="material-icons" style="font-size: 14px; vertical-align: middle;">filter_list</i>
                        Filter aktif:
                        ${this.searchState.term ? `Pencarian: "${this.searchState.term}"` : ''}
                        ${!this.searchState.showAll ? ' | Hanya data completed' : ''}
                        ${this.searchState.date ? ` | Tanggal: ${this.searchState.date}` : ''}
                    </div>
                </div>
            ` : ''}
        </div>

        <div style="flex: 1; overflow-y: auto; min-height: 0; max-height: 80vh;">
            <table class="compact-table">
                <thead>
                    <tr>
                        <th style="width: 25px;">No</th>
                        <th>Nomor Polisi</th>
                        <th style="width: 120px;">Kelengkapan</th>
                        <th style="width: 120px;">Status MRA</th>
                        <!-- ✅ TAMBAHKAN KOLOM STATUS JIKA SHOW ALL -->
                        ${showAllMode ? '<th style="width: 100px;">Status</th>' : ''}
                    </tr>
                </thead>
                <tbody id="table-body-not-accept">
                    ${this.renderNotAcceptTableRows(notAcceptData, showAllMode)}
                </tbody>
            </table>
        </div>
    </div>    <!-- Kanan -->
    <div style="flex: 4; display: flex; gap: 15px; min-width: 0; height: 100%; max-height: 80vh;">

        <!-- Panel kiri -->
        <div style="flex: 1; display: flex; flex-direction: column;">

            <div class="panel-colored" style="padding: 20px; border-radius: 8px;
                flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto;">

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; color: #0b3d91; font-size: 18px; font-weight: 600;">
                        <i class="material-icons colored-icon" style="margin-right: 8px; font-size: 20px;">person</i>
                        Detail Customer & Estimasi
                    </h3>
                    <div style="display: flex; gap: 8px;">
                        <button id="check-workorder" class="btn-large"><i class="material-icons">search</i></button>
                        <button id="sync-crm" class="btn-large"><i class="material-icons">sync</i></button>
                        <button id="download-pdf" class="btn-large"><i class="material-icons">download</i></button>
                    </div>
                </div>

                <div style="background:#ffffff; border:1px solid #aac7ff; padding:15px; border-radius:8px; margin-bottom:15px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h4 style="margin: 0; color: #0b3d91; font-size: 16px; font-weight: 600;">Pengaturan Diskon</h4>
        <button id="manual-diskon-btn" class="btn-primary" style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12px; background: #ff9800;">
            <i class="material-icons" style="font-size: 16px;">edit</i>
            Edit Manual
        </button>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
            <label style="display: block; margin-bottom: 6px;">Diskon Sparepart (%)</label>
            <input type="number" id="disc-sparepart-mid" min="0" max="100" value="${this.diskonSettings.sparepart}"
                style="width:100%; padding:12px; border:1px solid #aac7ff; border-radius:6px;">
        </div>
        <div>
            <label style="display: block; margin-bottom: 6px;">Diskon Jasa (%)</label>
            <input type="number" id="disc-jasa-mid" min="0" max="100" value="${this.diskonSettings.jasa}"
                style="width:100%; padding:12px; border:1px solid #aac7ff; border-radius:6px;">
        </div>
    </div>
</div>

                <div style="overflow-y: auto; flex: 1; min-height: 0;">
                    <div id="detail-content-left">
                        ${this.renderDetailContentLeft()}
                    </div>
                </div>

            </div>
        </div>

        <!-- Panel kanan -->
        <div style="flex: 1; display: flex; flex-direction: column;">

            <div class="panel-colored" style="padding: 20px; border-radius: 8px;
                flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto;">

                <!-- FIXED WA TEMPLATE -->
                <div id="wa-template-header">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #0b3d91; font-size: 18px; font-weight: 600;">
                            <i class="material-icons colored-icon" style="margin-right: 8px; font-size: 20px;">chat</i>
                            Template WhatsApp & Follow-up
                        </h3>
                    </div>
                </div>

                <!-- SCROLL AREA -->
                <div style="overflow-y: auto; flex: 1; min-height: 0; padding-top:10px;">
                    <div id="detail-content-right">
                        ${this.renderDetailContentRight()}
                    </div>
                </div>

            </div>
        </div>

    </div>
</div>
`;

            this.attachNotAcceptEvents();
        }

        renderNotAcceptTableRows(data) {
            const displayData = this.filteredData && this.filteredData.length > 0 ? this.filteredData : data;

            if (displayData.length === 0) {
                return '<tr><td colspan="4" style="text-align: center; padding: 30px; color: #666; font-size: 14px;">Tidak ada data estimasi completed</td></tr>';
            }

            return displayData.map((estimasi, index) => {
                const statusBadge = this.getMRAStatusBadge(estimasi.mra_status);
                const { hasSparepart, hasService, sparepartCount, serviceCount } = this.checkEstimasiCompleteness(estimasi);

                // Logika baru untuk menentukan warna dan status jasa
                let jasaColor = '#f44336'; // Default merah (belum lengkap)
                let jasaIcon = '✗';
                let jasaTooltip = 'Jasa: Belum lengkap';
                let jasaDot = '<div style="position: absolute; top: -5px; right: -5px; width: 8px; height: 8px; background: #ff9800; border-radius: 50%;"></div>';

                if (hasService) {
                    // Jika ada harga jasa dan bukan 0
                    jasaColor = '#4caf50'; // Hijau
                    jasaIcon = '✓';
                    jasaTooltip = `Jasa: Lengkap (${serviceCount} item)`;
                    jasaDot = '';
                } else if (estimasi.status === 'completed') {
                    // Jika status completed tapi harga jasa 0 atau tidak ada
                    jasaColor = '#ff9800'; // Kuning
                    jasaIcon = '✓';
                    jasaTooltip = 'Jasa: Tidak ada jasa (harga 0)';
                    jasaDot = '';
                } else if (estimasi.status === 'sent') {
                    // Jika status sent dan belum ada harga jasa
                    jasaColor = '#f44336'; // Merah
                    jasaIcon = '✗';
                    jasaTooltip = 'Jasa: Menunggu input harga jasa';
                    jasaDot = '<div style="position: absolute; top: -5px; right: -5px; width: 8px; height: 8px; background: #ff9800; border-radius: 50%;"></div>';
                }

                // Logika untuk sparepart (tetap sama)
                const sparepartColor = hasSparepart ? '#4caf50' : '#f44336';
                const sparepartIcon = hasSparepart ? '✓' : '✗';
                const sparepartTooltip = `Sparepart: ${hasSparepart ? 'Lengkap' : 'Belum lengkap'} (${sparepartCount} item)`;
                const sparepartDot = !hasSparepart ? '<div style="position: absolute; top: -5px; right: -5px; width: 8px; height: 8px; background: #ff9800; border-radius: 50%;"></div>' : '';

                return `
        <tr data-id="${estimasi.id}" style="cursor: pointer; background: ${estimasi.id === this.selectedId ? '#e3f2fd' : 'transparent'}; font-size: 14px;">
            <td style="padding: 12px; text-align: center;">${index + 1}</td>
            <td style="padding: 12px; font-weight: 500;">${estimasi.nopol || '-'}</td>
            <td style="padding: 12px; text-align: center;">
                <div style="display: flex; justify-content: center; gap: 15px;">
                    <!-- Marking Sparepart dengan Tooltip -->
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative;"
                         title="${sparepartTooltip}">
                        <div style="font-size: 10px; color: #666; font-weight: 500;">SPAREPART</div>
                        <div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                                  background: ${sparepartColor}; color: white; font-size: 14px; cursor: help;">
                            ${sparepartIcon}
                        </div>
                        ${sparepartDot}
                    </div>

                    <!-- Marking Jasa dengan Tooltip -->
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative;"
                         title="${jasaTooltip}">
                        <div style="font-size: 10px; color: #666; font-weight: 500;">JASA</div>
                        <div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                                  background: ${jasaColor}; color: white; font-size: 14px; cursor: help; font-weight: bold;">
                            ${jasaIcon}
                        </div>
                        ${jasaDot}
                    </div>
                </div>
            </td>
            <td style="padding: 12px; text-align: center;">${statusBadge}</td>
        </tr>
    `;
            }).join('');
        }

        renderDetailContentLeft() {
            if (!this.currentDetail) {
                return '<div style="text-align: center; color: #666; padding: 60px 20px; font-size: 16px;">Pilih estimasi untuk melihat detail</div>';
            }

            const estimasi = this.currentDetail;
            const spareparts = this.parseSpareparts(estimasi);
            const services = this.parseServices(estimasi);

            // Render foto section
            const fotoSection = this.renderFotoSection(estimasi);

            // Hitung dengan diskon manual
            let totalSparepartNormal = 0;
            let totalSparepartDiskon = 0;
            let totalServiceNormal = 0;
            let totalServiceDiskon = 0;

            // Hitung sparepart dengan diskon manual
            const sparepartItems = spareparts.map((part, index) => {
                const hargaNormal = (part.price || 0) * (part.qty || 1);
                const diskonManual = this.diskonSettings.manualSparepart[index] || 0;
                const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.sparepart;
                const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                totalSparepartNormal += hargaNormal;
                totalSparepartDiskon += hargaDiskon;

                return {
                    ...part,
                    hargaNormal,
                    hargaDiskon,
                    diskonAktif,
                    isManual: diskonManual > 0
                };
            });

            // Hitung jasa dengan diskon manual
            const serviceItems = services.map((service, index) => {
                const hargaNormal = (service.price || 0) * (service.hour || 1);
                const diskonManual = this.diskonSettings.manualJasa[index] || 0;
                const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.jasa;
                const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                totalServiceNormal += hargaNormal;
                totalServiceDiskon += hargaDiskon;

                return {
                    ...service,
                    hargaNormal,
                    hargaDiskon,
                    diskonAktif,
                    isManual: diskonManual > 0
                };
            });

            const totalKeseluruhan = Math.round(totalSparepartDiskon + totalServiceDiskon);

            return `
        <div style="space-y-4">
            <!-- Foto Estimasi -->
            ${fotoSection}

            <!-- Data Customer -->
            <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #1e3c72;">person</i>
                    Data Customer
                </h4>
                <div style="font-size: 14px; line-height: 1.5;">
                    <div><strong>Nopol:</strong> ${estimasi.nopol || '-'}</div>
                    <div><strong>Customer:</strong> ${estimasi.name_customer || '-'}</div>
                    <div><strong>Telepon:</strong> ${this.formatPhoneDisplay(estimasi.telepon_customer)}</div>
                    <div><strong>Mobil:</strong> ${estimasi.jenis_mobil || '-'}</div>
                    <div><strong>Rangka:</strong> ${estimasi.nomor_rangka || '-'}</div>
                    <div><strong>Status:</strong> ${estimasi.status =='pending' ? 'Menunggu Harga Sparepart' : estimasi.status =='progress' ? 'Menunggu input teknisi' : estimasi.status =='sent' ? 'Menunggu Harga Jasa' : estimasi.status =='completed' ? 'Menunggu Follow Up' : estimasi.status =='waiting' ? 'Menunggu balasan customer' : estimasi.status =='done' ? 'Sudah di Follow UP' : '-' || '-'}</div>
                </div>
            </div>

            <!-- Info Estimasi -->
            <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #1e3c72;">info</i>
                    Info Estimasi
                </h4>
                <div style="font-size: 14px; line-height: 1.5;">
                    <div><strong>Teknisi:</strong> ${estimasi.teknisi_name || '-'}</div>
                    <div><strong>Tanggal:</strong> ${new Date(estimasi.created_at).toLocaleDateString('id-ID')}</div>
                    <div><strong>Service Advisor:</strong> ${estimasi.service_advisor || '-'}</div>
                    <div><strong>Keterangan:</strong> ${estimasi.keterangan || '-'}</div>
                </div>
            </div>

            <!-- Detail Harga dengan Diskont Manual -->
            <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #1e3c72;">attach_money</i>
                    Detail Harga
                </h4>

                <!-- Sparepart -->
                ${sparepartItems.length > 0 ? `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: 600; font-size: 14px; color: #666; margin-bottom: 8px;">
                            SPAREPART
                            ${Object.keys(this.diskonSettings.manualSparepart).length > 0 ?
                `<span style="font-size: 12px; color: #ff9800; margin-left: 8px;">
                                    (${Object.keys(this.diskonSettings.manualSparepart).length} item dengan diskon manual)
                                </span>` : ''}
                        </div>

                        ${sparepartItems.map(item => `
                            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; padding: 4px 0; ${item.isManual ? 'background: #fff8e1; padding: 6px; border-radius: 4px;' : ''}">
                                <div>
                                    <span>${item.name}</span>
                                    ${item.isManual ?
                                             `<span style="font-size: 11px; color: #ff9800; margin-left: 6px;">(manual -${item.diskonAktif}%)</span>` :
                                             (item.diskonAktif > 0 ? `<span style="font-size: 11px; color: #4caf50; margin-left: 6px;">(auto -${item.diskonAktif}%)</span>` : '')
                                             }
                                </div>
                                <span>Rp ${Math.round(item.hargaDiskon).toLocaleString('id-ID')}</span>
                            </div>
                        `).join('')}

                        <div style="border-top: 1px solid #e0e0e0; padding-top: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 14px;">
                                <span>Total Sparepart Normal</span>
                                <span>Rp ${totalSparepartNormal.toLocaleString('id-ID')}</span>
                            </div>
                            ${this.diskonSettings.sparepart > 0 || Object.keys(this.diskonSettings.manualSparepart).length > 0 ? `
                                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #4caf50; margin-top: 4px;">
                                    <span>Total Diskon Sparepart</span>
                                    <span>-Rp ${(totalSparepartNormal - totalSparepartDiskon).toLocaleString('id-ID')}</span>
                                </div>
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 14px; color: #2e7d32; margin-top: 4px;">
                                <span>Total Setelah Diskon</span>
                                <span>Rp ${Math.round(totalSparepartDiskon).toLocaleString('id-ID')}</span>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <!-- Jasa -->
                ${serviceItems.length > 0 ? `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: 600; font-size: 14px; color: #666; margin-bottom: 8px;">
                            JASA
                            ${Object.keys(this.diskonSettings.manualJasa).length > 0 ?
                `<span style="font-size: 12px; color: #ff9800; margin-left: 8px;">
                                    (${Object.keys(this.diskonSettings.manualJasa).length} item dengan diskon manual)
                                </span>` : ''}
                        </div>

                        ${serviceItems.map(item => `
                            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; padding: 4px 0; ${item.isManual ? 'background: #fff8e1; padding: 6px; border-radius: 4px;' : ''}">
                                <div>
                                    <span>${item.name}</span>
                                    ${item.isManual ?
                                           `<span style="font-size: 11px; color: #ff9800; margin-left: 6px;">(manual -${item.diskonAktif}%)</span>` :
                                           (item.diskonAktif > 0 ? `<span style="font-size: 11px; color: #4caf50; margin-left: 6px;">(auto -${item.diskonAktif}%)</span>` : '')
                                           }
                                </div>
                                <span>Rp ${Math.round(item.hargaDiskon).toLocaleString('id-ID')}</span>
                            </div>
                        `).join('')}

                        <div style="border-top: 1px solid #e0e0e0; padding-top: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 14px;">
                                <span>Total Jasa Normal</span>
                                <span>Rp ${totalServiceNormal.toLocaleString('id-ID')}</span>
                            </div>
                            ${this.diskonSettings.jasa > 0 || Object.keys(this.diskonSettings.manualJasa).length > 0 ? `
                                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #4caf50; margin-top: 4px;">
                                    <span>Total Diskon Jasa</span>
                                    <span>-Rp ${(totalServiceNormal - totalServiceDiskon).toLocaleString('id-ID')}</span>
                                </div>
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 14px; color: #2e7d32; margin-top: 4px;">
                                <span>Total Setelah Diskon</span>
                                <span>Rp ${Math.round(totalServiceDiskon).toLocaleString('id-ID')}</span>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <!-- Total Keseluruhan -->
                <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 16px; background: #f8f9fa; padding: 12px; border-radius: 6px; margin-top: 12px;">
                    <span>TOTAL KESELURUHAN</span>
                    <span style="color: #e60000;">Rp ${totalKeseluruhan.toLocaleString('id-ID')}</span>
                </div>

                <!-- Informasi Diskon -->
                ${(Object.keys(this.diskonSettings.manualSparepart).length > 0 || Object.keys(this.diskonSettings.manualJasa).length > 0) ? `
                    <div style="margin-top: 12px; padding: 8px; background: #fff8e1; border-radius: 4px; border-left: 4px solid #ff9800;">
                        <div style="font-size: 12px; color: #e65100;">
                            <i class="material-icons" style="font-size: 14px; vertical-align: middle;">info</i>
                            <strong>Diskon Manual Aktif:</strong>
                            ${Object.keys(this.diskonSettings.manualSparepart).length > 0 ?
                `${Object.keys(this.diskonSettings.manualSparepart).length} sparepart` : ''}
                            ${Object.keys(this.diskonSettings.manualSparepart).length > 0 && Object.keys(this.diskonSettings.manualJasa).length > 0 ? ' dan ' : ''}
                            ${Object.keys(this.diskonSettings.manualJasa).length > 0 ?
                `${Object.keys(this.diskonSettings.manualJasa).length} jasa` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>

            ${this.customerDetail ? this.renderCustomerDetail() : ''}
        </div>
    `;
        }

        renderDetailContentRight() {
            if (!this.currentDetail) {
                return '<div style="text-align: center; color: #666; padding: 60px 20px; font-size: 16px;">Pilih estimasi untuk melihat template</div>';
            }

            const estimasi = this.currentDetail;

            return `
        <div style="space-y-4">
            <!-- Template WhatsApp -->
            <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #25D366;">chat</i>
                    Template WhatsApp
                </h4>

                <!-- Template Display Area dengan ID khusus -->
                <div id="whatsapp-template-display" style="background: #f8f9fa; padding: 15px; border-radius: 6px; font-size: 14px; line-height: 1.5; min-height: 150px; max-height: 250px; overflow-y: auto; border: 1px solid #e0e0e0;">
                    ${this.generateWhatsAppTemplateByType(estimasi, 'formal_ramah')}
                </div>

      <!-- Tombol Pilihan Template dengan Edit masing-masing -->
<div style="margin-top: 15px;">
    <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; color: #333;">Pilih Template:</label>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
        <!-- Template 1 - Inti Estimasi -->
        <div style="display: flex; gap: 4px;">
            <button type="button" class="template-btn btn-small active" data-template="inti_estimasi" style="flex: 1; background: #1976d2; color: white; border: 1px solid #1976d2;">
                Template 1 — Inti Estimasi
            </button>
            <button type="button" class="edit-template-btn btn-small" data-template="inti_estimasi" style="background: #ff9800; color: white; border: none; padding: 8px; border-radius: 4px;">
                <i class="material-icons" style="font-size: 14px;">edit</i>
            </button>
        </div>

        <!-- Template 2 - Daftar Harga -->
        <div style="display: flex; gap: 4px;">
            <button type="button" class="template-btn btn-small" data-template="daftar_harga" style="flex: 1; background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">
                Template 2 — Daftar Harga
            </button>
            <button type="button" class="edit-template-btn btn-small" data-template="daftar_harga" style="background: #ff9800; color: white; border: none; padding: 8px; border-radius: 4px;">
                <i class="material-icons" style="font-size: 14px;">edit</i>
            </button>
        </div>

        <!-- Template 3 - Tidak Tertarik -->
        <div style="display: flex; gap: 4px;">
            <button type="button" class="template-btn btn-small" data-template="respon_tidak_tertarik" style="flex: 1; background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">
                Template 3 — Tidak Tertarik
            </button>
            <button type="button" class="edit-template-btn btn-small" data-template="respon_tidak_tertarik" style="background: #ff9800; color: white; border: none; padding: 8px; border-radius: 4px;">
                <i class="material-icons" style="font-size: 14px;">edit</i>
            </button>
        </div>

        <!-- Template 4 - Respon Tertarik -->
        <div style="display: flex; gap: 4px;">
            <button type="button" class="template-btn btn-small" data-template="respon_tertarik" style="flex: 1; background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">
                Template 4 — Respon Tertarik
            </button>
            <button type="button" class="edit-template-btn btn-small" data-template="respon_tertarik" style="background: #ff9800; color: white; border: none; padding: 8px; border-radius: 4px;">
                <i class="material-icons" style="font-size: 14px;">edit</i>
            </button>
        </div>
    </div>
</div>

                <!-- Tombol Kirim WhatsApp -->
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button id="send-whatsapp-template" class="btn-primary" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; background: #25D366 !important; padding: 12px 16px; font-size: 16px; font-weight: 600;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893c0-3.189-1.248-6.189-3.515-8.452"/>
                        </svg>
                        Kirim WhatsApp
                    </button>
                    <button id="copy-template-bottom" class="btn-secondary" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="material-icons" style="font-size: 18px;">content_copy</i>
                        Salin
                    </button>
                </div>
            </div>

            <!-- Form Follow-up -->
            <div style="background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px; font-weight: 600;">
                    <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #2196F3;">update</i>
                    Form Follow-up
                </h4>
                <form id="follow-up-form">
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500;">Status</label>
                        <select name="mra_status" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                            <option value="">Pilih Status</option>
                            <option value="contacted" ${estimasi.mra_status === 'contacted' ? 'selected' : ''}>📞 Dihubungi</option>
                            <option value="interested" ${estimasi.mra_status === 'interested' ? 'selected' : ''}>👍 Tertarik</option>
                            <option value="not_interested" ${estimasi.mra_status === 'not_interested' ? 'selected' : ''}>👎 Tidak Tertarik</option>
                            <option value="accepted" ${estimasi.mra_status === 'accepted' ? 'selected' : ''}>✅ ACC</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500;">Catatan</label>
                        <textarea name="mra_catatan" placeholder="Catatan follow-up..."
                                  style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; min-height: 80px; resize: vertical;">${estimasi.mra_catatan || ''}</textarea>
                    </div>

                    ${this.renderSparepartSelection(estimasi)}

                    <button type="submit" class="btn-primary" style="width: 100%; padding: 12px; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="material-icons" style="font-size: 18px;">save</i>
                        Simpan Follow-up
                    </button>
                </form>
            </div>
        </div>
    `;
        }

        generateWhatsAppTemplateByType(estimasi, templateType = 'inti_estimasi') {
            const spareparts = this.parseSpareparts(estimasi);
            const services = this.parseServices(estimasi);

            // Hitung dengan diskon manual
            let totalSparepartNormal = 0;
            let totalSparepartDiskon = 0;
            let totalServiceNormal = 0;
            let totalServiceDiskon = 0;

            spareparts.forEach((part, index) => {
                const hargaNormal = (part.price || 0) * (part.qty || 1);
                const diskonManual = this.diskonSettings.manualSparepart[index] || 0;
                const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.sparepart;
                const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                totalSparepartNormal += hargaNormal;
                totalSparepartDiskon += hargaDiskon;
            });

            services.forEach((service, index) => {
                const hargaNormal = (service.price || 0) * (service.hour || 1);
                const diskonManual = this.diskonSettings.manualJasa[index] || 0;
                const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.jasa;
                const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                totalServiceNormal += hargaNormal;
                totalServiceDiskon += hargaDiskon;
            });

            const totalSebelumDiskon = totalSparepartNormal + totalServiceNormal;
            const totalSetelahDiskon = totalSparepartDiskon + totalServiceDiskon;
            const totalDiskon = totalSebelumDiskon - totalSetelahDiskon;

            // Format nama customer
            const namaCustomer = estimasi.name_customer || 'Bapak/Ibu';

            // Hitung hari sejak created_at
            const hariLalu = this.hitungHariLalu(estimasi.created_at);

            // Template berdasarkan jenis
            let template = '';

            switch(templateType) {
                case 'daftar_harga':
                    // TEMPLATE 2: Daftar Harga Komponen (untuk copy-paste ke customer) - PERBAIKAN: GUNAKAN DISKON MANUAL
                    let sparepartList = '';
                    let jasaList = '';

                    // Format sparepart dengan diskon manual
                    if (spareparts.length > 0) {
                        sparepartList = `🔧 SPAREPART:\n`;
                        spareparts.forEach((part, index) => {
                            const hargaNormal = (part.price || 0) * (part.qty || 1);

                            // PERBAIKAN: GUNAKAN DISKON MANUAL JIKA ADA
                            const diskonManual = this.diskonSettings.manualSparepart[index] || 0;
                            const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.sparepart;
                            const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                            sparepartList += `• ${part.name || 'Sparepart'}\n`;
                            sparepartList += `  Harga normal: Rp ${hargaNormal.toLocaleString('id-ID')}\n`;

                            if (diskonAktif > 0) {
                                if (diskonManual > 0) {
                                    sparepartList += `  Harga diskon: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')} (diskon ${diskonAktif}%)\n\n`;
                                } else {
                                    sparepartList += `  Harga diskon: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')} (diskon ${diskonAktif}%)\n\n`;
                                }
                            } else {
                                sparepartList += `  Harga: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')}\n\n`;
                            }
                        });
                    }

                    // Format jasa dengan diskon manual
                    if (services.length > 0) {
                        jasaList = `🧰 JASA:\n`;
                        services.forEach((service, index) => {
                            const hargaNormal = (service.price || 0) * (service.hour || 1);

                            // PERBAIKAN: GUNAKAN DISKON MANUAL JIKA ADA
                            const diskonManual = this.diskonSettings.manualJasa[index] || 0;
                            const diskonAktif = diskonManual > 0 ? diskonManual : this.diskonSettings.jasa;
                            const hargaDiskon = hargaNormal * (1 - diskonAktif / 100);

                            jasaList += `• ${service.name || 'Jasa'}\n`;
                            jasaList += `  Harga normal: Rp ${hargaNormal.toLocaleString('id-ID')}\n`;

                            if (diskonAktif > 0) {
                                if (diskonManual > 0) {
                                    jasaList += `  Harga diskon: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')} (diskon ${diskonAktif}%)\n\n`;
                                } else {
                                    jasaList += `  Harga diskon: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')} (diskon ${diskonAktif}%)\n\n`;
                                }
                            } else {
                                jasaList += `  Harga: Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')}\n\n`;
                            }
                        });
                    }

                    template = `${sparepartList}${jasaList}`;
                    break;

                case 'respon_tidak_tertarik':
                    // TEMPLATE 3: Respon Tidak Tertarik
                    template = `Terima kasih atas waktunya. Kami tunggu konfirmasi penggantian di nomor ini. Jika suatu hari membutuhkan bantuan teknis atau penjadwalan pergantian part, kami siap membantu. 🙏`;
                    break;

                case 'respon_tertarik':
                    // TEMPLATE 4: Respon Tertarik
                    template = `Terimakasih sudah memberikan kepercayaan untuk mengganti sparepart di Tunas Toyota Batutulis, Kami pastikan sparepart original Toyota dan memberikan pelayanan terbaik kami 🙏`;
                    break;

                case 'inti_estimasi':
                default:
                    // TEMPLATE 1: Inti Estimasi dengan Diskon
                    template = `Bapak/Ibu ${namaCustomer} yang terhormat,

Terkait kunjungan servis ${hariLalu}, berikut kami lampirkan saran perbaikan untuk ${estimasi.jenis_mobil || ''} ${estimasi.nopol || ''} ${estimasi.nomor_rangka ? `(Nomor rangka: ${estimasi.nomor_rangka})` : ''}.

Kami berikan diskon spesial:
${this.diskonSettings.sparepart > 0 ? `• Diskon sparepart ${this.diskonSettings.sparepart}%\n` : ''}${this.diskonSettings.jasa > 0 ? `• Diskon jasa ${this.diskonSettings.jasa}%\n` : ''}
💰 RINGKASAN HARGA:

Total Normal: ~~Rp ${totalSebelumDiskon.toLocaleString('id-ID')}~~
Total Diskon: Rp ${Math.round(totalDiskon).toLocaleString('id-ID')}
*TOTAL SETELAH DISKON: Rp ${Math.round(totalSetelahDiskon).toLocaleString('id-ID')}*

Pekerjaan dapat kami jadwalkan segera setelah konfirmasi dari Bapak/Ibu.

Hormat kami,
Tunas Toyota Batu Tulis 🚗✨`;
                    break;
            }

            return template.replace(/\n/g, '<br>');
        }


        generateWhatsAppTemplate(estimasi) {
            const spareparts = this.parseSpareparts(estimasi);
            const services = this.parseServices(estimasi);

            let totalSparepartNormal = 0;
            let totalSparepartDiskon = 0;
            let totalServiceNormal = 0;
            let totalServiceDiskon = 0;

            // Hitung total sparepart sebelum dan sesudah diskon
            spareparts.forEach(part => {
                const hargaNormal = (part.price || 0) * (part.qty || 1);
                const hargaDiskon = hargaNormal * (1 - this.diskonSettings.sparepart / 100);
                totalSparepartNormal += hargaNormal;
                totalSparepartDiskon += hargaDiskon;
            });

            // Hitung total jasa sebelum dan sesudah diskon
            services.forEach(service => {
                const hargaNormal = (service.price || 0) * (service.hour || 1);
                const hargaDiskon = hargaNormal * (1 - this.diskonSettings.jasa / 100);
                totalServiceNormal += hargaNormal;
                totalServiceDiskon += hargaDiskon;
            });

            const totalSebelumDiskon = totalSparepartNormal + totalServiceNormal;
            const totalSetelahDiskon = totalSparepartDiskon + totalServiceDiskon;
            const totalDiskon = totalSebelumDiskon - totalSetelahDiskon;

            // Format nama customer
            const namaCustomer = estimasi.name_customer || 'Kak';
            const panggilan = namaCustomer.includes(' ') ? namaCustomer.split(' ')[0] : namaCustomer;

            // Hitung hari sejak created_at
            const hariLalu = this.hitungHariLalu(estimasi.created_at);

            // Format sparepart dengan diskon per item
            let sparepartTemplate = '';
            if (spareparts.length > 0) {
                sparepartTemplate = `🔧 *Estimasi Sparepart* ${this.diskonSettings.sparepart > 0 ? `(Diskon ${this.diskonSettings.sparepart}%)` : ''}\n\n`;

                spareparts.forEach(part => {
                    const hargaNormal = (part.price || 0) * (part.qty || 1);
                    const hargaDiskon = hargaNormal * (1 - this.diskonSettings.sparepart / 100);

                    if (this.diskonSettings.sparepart > 0) {
                        sparepartTemplate += `• ${part.name || 'Sparepart'}\n`;
                        sparepartTemplate += `  Rp ${hargaNormal.toLocaleString('id-ID')} → Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')}\n\n`;
                    } else {
                        sparepartTemplate += `• ${part.name || 'Sparepart'}\n`;
                        sparepartTemplate += `  Rp ${hargaNormal.toLocaleString('id-ID')}\n\n`;
                    }
                });

                // Total sparepart
                if (this.diskonSettings.sparepart > 0) {
                    sparepartTemplate += `*Total Sparepart:*\n`;
                    sparepartTemplate += `Rp ${totalSparepartNormal.toLocaleString('id-ID')} → Rp ${Math.round(totalSparepartDiskon).toLocaleString('id-ID')}\n\n`;
                } else {
                    sparepartTemplate += `*Total Sparepart:* Rp ${totalSparepartNormal.toLocaleString('id-ID')}\n\n`;
                }
            }

            // Format jasa dengan diskon per item
            let jasaTemplate = '';
            if (services.length > 0) {
                jasaTemplate = `🧰 *Jasa Pengerjaan* ${this.diskonSettings.jasa > 0 ? `(Diskon ${this.diskonSettings.jasa}%)` : ''}\n\n`;

                services.forEach(service => {
                    const hargaNormal = (service.price || 0) * (service.hour || 1);
                    const hargaDiskon = hargaNormal * (1 - this.diskonSettings.jasa / 100);

                    if (this.diskonSettings.jasa > 0) {
                        jasaTemplate += `• ${service.name || 'Jasa'}\n`;
                        jasaTemplate += `  Rp ${hargaNormal.toLocaleString('id-ID')} → Rp ${Math.round(hargaDiskon).toLocaleString('id-ID')}\n\n`;
                    } else {
                        jasaTemplate += `• ${service.name || 'Jasa'}\n`;
                        jasaTemplate += `  Rp ${hargaNormal.toLocaleString('id-ID')}\n\n`;
                    }
                });

                // Total jasa
                if (this.diskonSettings.jasa > 0) {
                    jasaTemplate += `*Total Jasa:*\n`;
                    jasaTemplate += `Rp ${totalServiceNormal.toLocaleString('id-ID')} → Rp ${Math.round(totalServiceDiskon).toLocaleString('id-ID')}\n\n`;
                } else {
                    jasaTemplate += `*Total Jasa:* Rp ${totalServiceNormal.toLocaleString('id-ID')}\n\n`;
                }
            }

            // Template akhir
            let template = `Halo ${panggilan} ${estimasi.name_customer ? '👋🙂' : '👋'}

Terkait kedatangan servis ${hariLalu}, berikut estimasi untuk ${estimasi.jenis_mobil || ''} ${estimasi.nopol || ''} ${estimasi.nomor_rangka ? `(Nomor rangka: ${estimasi.nomor_rangka})` : ''}:

${sparepartTemplate}${jasaTemplate}🧾 *RINGKASAN TOTAL*

${totalDiskon > 0 ? `
*Total Normal:* Rp ${totalSebelumDiskon.toLocaleString('id-ID')}
*Total Diskon:* Rp ${Math.round(totalDiskon).toLocaleString('id-ID')}
` : ''}

💰 *TOTAL ESTIMASI:* Rp ${Math.round(totalSetelahDiskon).toLocaleString('id-ID')}

jika Bpk/Ibu berkenan pekerjaan bisa kami jadwalkan hari ini atau kapan pun 😊🙏

Hormat kami
tunas TOYOTA Batu Tulis 🚗✨`;

            return template.replace(/\n/g, '<br>');
        }

        // Method untuk menghitung hari lalu
        hitungHariLalu(tanggal) {
            if (!tanggal) return 'beberapa hari lalu';

            const createdDate = new Date(tanggal);
            const today = new Date();
            const diffTime = Math.abs(today - createdDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) return '1 hari lalu';
            if (diffDays === 2) return '2 hari lalu';
            return `${diffDays} hari lalu`;
        }

        renderSparepartSelection(estimasi) {
            const spareparts = this.parseSpareparts(estimasi);
            if (spareparts.length === 0) return '';

            const selectedSpareparts = estimasi.mra_selected_spareparts || [];

            return `
                <div style="margin-bottom: 12px;">
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500;">Sparepart yang Disetujui</label>
                    <div style="max-height: 120px; overflow-y: auto; border: 1px solid #ddd; border-radius: 6px; padding: 12px; background: white;">
                        ${spareparts.map((sparepart, index) => `
                            <label style="display: flex; align-items: center; margin-bottom: 8px; cursor: pointer; font-size: 14px;">
                                <input type="checkbox" name="mra_selected_spareparts" value="${index}"
                                       ${selectedSpareparts.includes(index) ? 'checked' : ''}
                                       style="margin-right: 8px; transform: scale(1.2);">
                                <span style="flex: 1;">${sparepart.name || 'Sparepart'}</span>
                                <span style="color: #666; font-size: 13px;">Rp ${(sparepart.price || 0).toLocaleString('id-ID')}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        calculateTotalAfterDiscount(estimasi) {
            const spareparts = this.parseSpareparts(estimasi);
            const services = this.parseServices(estimasi);

            let totalSparepart = 0;
            let totalService = 0;

            spareparts.forEach(part => {
                totalSparepart += (part.price || 0) * (part.qty || 1);
            });

            services.forEach(service => {
                totalService += (service.price || 0) * (service.hour || 1);
            });

            // Gunakan diskonSettings yang terupdate
            const sparepartAfterDiscount = totalSparepart * (1 - this.diskonSettings.sparepart / 100);
            const serviceAfterDiscount = totalService * (1 - this.diskonSettings.jasa / 100);

            return Math.round(sparepartAfterDiscount + serviceAfterDiscount);
        }

        formatPhoneDisplay(phoneData) {
            if (!phoneData) return '-';
            const phoneRegex = /(\d{10,})|(\(\d{10,}\))/g;
            const matches = phoneData.match(phoneRegex);
            if (!matches || matches.length === 0) return '-';
            const firstPhone = matches[0].replace(/[\(\)]/g, '');
            return this.truncateText(firstPhone, 12);
        }

        truncateText(text, maxLength) {
            if (!text) return '-';
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength) + '...';
        }

        getMRAStatusBadge(status) {
            const statusConfig = {
                'pending': { color: '#ff9800', text: 'Pending' },
                'contacted': { color: '#2196f3', text: 'Dihubungi' },
                'interested': { color: '#4caf50', text: 'Tertarik' },
                'not_interested': { color: '#f44336', text: 'Tidak Tertarik' },
                'accepted': { color: '#2e7d32', text: 'ACC' }
            };

            const config = statusConfig[status] || { color: '#666', text: 'Belum' };
            return `<span style="background: ${config.color}; color: white; padding: 4px 8px; border-radius: 10px; font-size: 12px; display: inline-block;">${config.text}</span>`;
        }

        attachNotAcceptEvents() {
            console.log('🔧 Attaching search events...');

            // ✅ PERBAIKAN: Gunakan event delegation yang stabil
            const searchInput = document.getElementById('search-not-accept');
            if (searchInput) {
                console.log('✅ Search input found, attaching events...');

                // Hapus event listeners lama jika ada
                const newSearchInput = searchInput.cloneNode(true);
                searchInput.parentNode.replaceChild(newSearchInput, searchInput);

                // Pasang event listeners baru
                newSearchInput.addEventListener('input', (e) => {
                    console.log('🔍 Input event:', e.target.value);
                    this.filterNotAcceptData(e.target.value);
                });

                newSearchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        this.searchState.term = '';
                        this.filterNotAcceptData('');
                    }
                });

                // ✅ OTOMATIS FOKUS SETELAH RENDER
                this.focusSearchInput();
            }

            // ✅ TOMBOL RESET FILTERS - TAMBAHKAN DEBUG
            const resetFiltersBtn = document.getElementById('reset-filters');
            if (resetFiltersBtn) {
                console.log('✅ Reset button found');
                resetFiltersBtn.addEventListener('click', () => {
                    console.log('🔄 Reset button clicked');
                    this.resetFilters();
                });
            } else {
                console.log('❌ Reset button NOT found');
            }

            // ✅ TOMBOL TOGGLE SHOW ALL - TAMBAHKAN DEBUG
            const toggleShowAllBtn = document.getElementById('toggle-show-all');
            if (toggleShowAllBtn) {
                console.log('✅ Toggle button found');
                toggleShowAllBtn.addEventListener('click', () => {
                    console.log('🔄 Toggle button clicked');
                    this.toggleShowAll();
                });
            } else {
                console.log('❌ Toggle button NOT found');
            }

            // Date filter
            const dateFilter = document.getElementById('date-filter-not-accept');
            if (dateFilter) {
                if (!this.searchState.date) {
                    const today = new Date();
                    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                    this.searchState.date = firstDay.toISOString().split('T')[0];
                    dateFilter.value = this.searchState.date;
                }

                dateFilter.addEventListener('change', (e) => {
                    this.searchState.date = e.target.value;
                    this.filterNotAcceptByDate(e.target.value);
                });
            }

            // Row selection dengan event delegation yang lebih baik
            document.addEventListener('click', (e) => {
                const row = e.target.closest('#table-body-not-accept tr');
                if (row) {
                    document.querySelectorAll('#table-body-not-accept tr').forEach(r => {
                        r.style.background = 'transparent';
                    });
                    row.style.background = '#e3f2fd';

                    const estimasiId = row.getAttribute('data-id');
                    this.selectedId = estimasiId;
                    this.currentDetail = this.estimasiData.find(e => e.id === estimasiId);
                    currentEstimasiId = estimasiId;
                    this.customerDetail = null;
                    this.renderCurrentTab();
                }
            });

            // Manual diskon button
            const manualDiskonBtn = document.getElementById('manual-diskon-btn');
            if (manualDiskonBtn) {
                manualDiskonBtn.addEventListener('click', () => {
                    this.showManualDiskonModal();
                });
            }

            // Diskont settings
            const discSparepartMid = document.getElementById('disc-sparepart-mid');
            const discJasaMid = document.getElementById('disc-jasa-mid');

            const updateDiskonSettings = () => {
                this.diskonSettings.sparepart = parseInt(discSparepartMid?.value) || 0;
                this.diskonSettings.jasa = parseInt(discJasaMid?.value) || 0;
                this.renderCurrentTab();
            };

            if (discSparepartMid) {
                discSparepartMid.addEventListener('change', updateDiskonSettings);
                discSparepartMid.addEventListener('input', updateDiskonSettings);
            }

            if (discJasaMid) {
                discJasaMid.addEventListener('change', updateDiskonSettings);
                discJasaMid.addEventListener('input', updateDiskonSettings);
            }

            // Event untuk navigasi foto
            this.attachFotoEvents();
        }

        attachButtonEvents() {
            // Event untuk tombol template
            setTimeout(() => {
                document.querySelectorAll('.template-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const templateType = e.target.getAttribute('data-template');

                        // Update tampilan template di kotak teks
                        this.updateTemplateDisplay(templateType);

                        // Highlight tombol yang aktif
                        document.querySelectorAll('.template-btn').forEach(b => {
                            b.style.background = '#e3f2fd';
                            b.style.color = '#1976d2';
                            b.style.border = '1px solid #bbdefb';
                            b.classList.remove('active');
                        });

                        e.target.style.background = '#1976d2';
                        e.target.style.color = 'white';
                        e.target.style.border = '1px solid #1976d2';
                        e.target.classList.add('active');

                        // Simpan template yang dipilih
                        this.selectedTemplateType = templateType;
                    });
                });
            }, 100);

            // Update event untuk kirim WhatsApp agar menggunakan template yang dipilih
            const sendWhatsAppTemplate = document.getElementById('send-whatsapp-template');
            if (sendWhatsAppTemplate) {
                sendWhatsAppTemplate.addEventListener('click', () => {
                    const templateType = this.selectedTemplateType || 'formal_ramah';
                    this.openWhatsAppWithTemplate(templateType);
                });
            }

            // Update event untuk copy template
            const copyTemplateBottom = document.getElementById('copy-template-bottom');
            if (copyTemplateBottom) {
                copyTemplateBottom.addEventListener('click', () => {
                    const templateType = this.selectedTemplateType || 'formal_ramah';
                    this.copyTemplateToClipboard(templateType);
                });
            }
            // Check Work Order (dummy)
            // Di dalam method attachButtonEvents(), GANTI bagian ini:
            const checkWorkorder = document.getElementById('check-workorder');
            if (checkWorkorder) {
                checkWorkorder.addEventListener('click', () => {
                    // GANTI dari notifikasi "dalam pengembangan" menjadi:
                    this.checkWorkOrder();
                });
            }

            // Di dalam method attachButtonEvents(), TAMBAHKAN:
            // Event untuk tombol template
            document.querySelectorAll('.template-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const templateType = e.target.getAttribute('data-template');

                    // Update tampilan template
                    const templateContainer = document.querySelector('#detail-content-right .template-display');
                    if (templateContainer && this.currentDetail) {
                        templateContainer.innerHTML = this.generateWhatsAppTemplateByType(this.currentDetail, templateType);
                    }

                    // Highlight tombol yang aktif
                    document.querySelectorAll('.template-btn').forEach(b => {
                        b.style.background = '';
                        b.style.color = '';
                        b.style.border = '1px solid #ddd';
                    });

                    e.target.style.background = '#1976d2';
                    e.target.style.color = 'white';
                    e.target.style.border = '1px solid #1976d2';

                    // Simpan template yang dipilih
                    this.selectedTemplateType = templateType;
                });
            });

            // Di dalam method attachButtonEvents(), GANTI bagian ini:
            const syncCrm = document.getElementById('sync-crm');
            if (syncCrm) {
                syncCrm.addEventListener('click', () => {
                    // GANTI dari notifikasi "dalam pengembangan" menjadi:
                    this.syncWithCRM5();
                });
            }

            // Download PDF
            const downloadPdf = document.getElementById('download-pdf');
            if (downloadPdf) {
                downloadPdf.addEventListener('click', () => {
                    if (this.currentDetail) {
                        generatePdfA5();
                    } else {
                        this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                    }
                });
            }

            // Send WhatsApp Main
            const sendWhatsAppMain = document.getElementById('send-whatsapp-main');
            if (sendWhatsAppMain) {
                sendWhatsAppMain.addEventListener('click', () => {
                    this.openWhatsAppWithTemplate();
                });
            }

            setTimeout(() => {
                document.querySelectorAll('.template-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const templateType = e.target.getAttribute('data-template');

                        // Update tampilan template di kotak teks
                        this.updateTemplateDisplay(templateType);

                        // Highlight tombol yang aktif
                        document.querySelectorAll('.template-btn').forEach(b => {
                            b.style.background = '#e3f2fd';
                            b.style.color = '#1976d2';
                            b.style.border = '1px solid #bbdefb';
                            b.classList.remove('active');
                        });

                        e.target.style.background = '#1976d2';
                        e.target.style.color = 'white';
                        e.target.style.border = '1px solid #1976d2';
                        e.target.classList.add('active');

                        // Simpan template yang dipilih
                        this.selectedTemplateType = templateType;
                    });
                });

                // Event untuk tombol edit masing-masing template
                document.querySelectorAll('.edit-template-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation(); // Mencegah trigger event parent
                        const templateType = e.target.closest('.edit-template-btn').getAttribute('data-template');
                        this.openTemplateEditor(templateType);
                    });
                });
            }, 100);

            // Copy Template
            const copyTemplate = document.getElementById('copy-template');
            if (copyTemplate) {
                copyTemplate.addEventListener('click', () => {
                    this.copyTemplateToClipboard();
                });
            }

            // Follow-up form
            const followUpForm = document.getElementById('follow-up-form');
            if (followUpForm) {
                followUpForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveFollowUp();
                });
            }
        }
        openTemplateEditor(templateType = 'formal_ramah') {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            // Gunakan template yang dipilih atau template default
            const currentTemplate = this.generateWhatsAppTemplateByType(this.currentDetail, templateType).replace(/<br>/g, '\n');

            const editorHtml = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
            <div style="background: white; padding: 25px; border-radius: 10px; width: 600px; max-width: 90%; max-height: 90vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0; color: #333; font-size: 20px;">
                        <i class="material-icons" style="vertical-align: middle; margin-right: 8px; color: #ff9800;">edit</i>
                        Edit Template ${this.getTemplateDisplayName(templateType)}
                    </h3>
                    <button id="close-editor" style="background: none; border: none; cursor: pointer; color: #666;">
                        <i class="material-icons" style="font-size: 24px;">close</i>
                    </button>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 16px;">Template Pesan</label>
                    <textarea id="template-editor" style="width: 100%; height: 250px; padding: 15px; border: 1px solid #ddd; border-radius: 6px; resize: vertical; font-family: Arial, sans-serif; line-height: 1.5; font-size: 14px;">${currentTemplate}</textarea>
                </div>

                <div style="display: flex; gap: 12px; margin-bottom: 20px;">
                    <button type="button" id="btn-bold" class="btn-small" style="flex: 1; padding: 12px; font-size: 14px; background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">
                        <i class="material-icons" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">format_bold</i>
                        Bold
                    </button>
                    <button type="button" id="btn-italic" class="btn-small" style="flex: 1; padding: 12px; font-size: 14px; background: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">
                        <i class="material-icons" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">format_italic</i>
                        Italic
                    </button>
                    <button type="button" id="btn-reset" class="btn-small" style="flex: 1; padding: 12px; font-size: 14px; background: #fff3e0; color: #f57c00; border: 1px solid #ffe0b2;">
                        <i class="material-icons" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">refresh</i>
                        Reset
                    </button>
                </div>

                <div style="display: flex; gap: 12px;">
                    <button id="cancel-editor" class="btn-secondary" style="flex: 1; padding: 12px; font-size: 16px;">
                        <i class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">close</i>
                        Batal
                    </button>
                    <button id="save-template" class="btn-primary" style="flex: 1; padding: 12px; font-size: 16px; background: #4caf50;">
                        <i class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">save</i>
                        Simpan
                    </button>
                </div>
            </div>
        </div>
    `;

            const editorDiv = document.createElement('div');
            editorDiv.innerHTML = editorHtml;
            document.body.appendChild(editorDiv);

            // Text formatting buttons
            const textarea = editorDiv.querySelector('#template-editor');
            editorDiv.querySelector('#btn-bold').addEventListener('click', () => {
                this.wrapSelectedText(textarea, '*');
            });
            editorDiv.querySelector('#btn-italic').addEventListener('click', () => {
                this.wrapSelectedText(textarea, '_');
            });
            editorDiv.querySelector('#btn-reset').addEventListener('click', () => {
                textarea.value = this.generateWhatsAppTemplateByType(this.currentDetail, templateType).replace(/<br>/g, '\n');
            });

            // Close events
            const closeEditor = () => document.body.removeChild(editorDiv);
            editorDiv.querySelector('#close-editor').addEventListener('click', closeEditor);
            editorDiv.querySelector('#cancel-editor').addEventListener('click', closeEditor);

            // Save template
            editorDiv.querySelector('#save-template').addEventListener('click', () => {
                const newTemplate = textarea.value;
                // Simpan template custom (bisa disimpan ke localStorage atau database)
                this.saveCustomTemplate(templateType, newTemplate);
                this.showNotification(`Template "${this.getTemplateDisplayName(templateType)}" berhasil disimpan!`, 'success');
                closeEditor();

                // Update tampilan jika template yang diedit sedang aktif
                if (this.selectedTemplateType === templateType) {
                    this.updateTemplateDisplay(templateType);
                }
            });
        }

        // Method helper untuk mendapatkan nama display template
        getTemplateDisplayName(templateType) {
            const names = {
                'inti_estimasi': 'Inti Estimasi',
                'daftar_harga': 'Daftar Harga',
                'respon_tidak_tertarik': 'Tidak Tertarik',
                'respon_tertarik': 'Respon Tertarik'
            };
            return names[templateType] || templateType;
        }

        // Method untuk menyimpan template custom (simpan di localStorage)
        saveCustomTemplate(templateType, templateContent) {
            const customTemplates = JSON.parse(localStorage.getItem('mra_custom_templates') || '{}');
            customTemplates[templateType] = templateContent;
            localStorage.setItem('mra_custom_templates', JSON.stringify(customTemplates));
        }

        // Method untuk memuat template custom
        loadCustomTemplate(templateType) {
            const customTemplates = JSON.parse(localStorage.getItem('mra_custom_templates') || '{}');
            return customTemplates[templateType] || null;
        }

        // Method helper untuk mendapatkan nama display template
        getTemplateDisplayName(templateType) {
            const names = {
                'formal_ramah': 'Formal Ramah',
                'sangat_formal': 'Sangat Formal',
                'formal_bersahabat': 'Formal Bersahabat',
                'singkat_padat': 'Singkat & Padat',
                'elegan_customer': 'Elegan & Customer-Oriented'
            };
            return names[templateType] || templateType;
        }

        // Method untuk menyimpan template custom (simpan di localStorage)
        saveCustomTemplate(templateType, templateContent) {
            const customTemplates = JSON.parse(localStorage.getItem('mra_custom_templates') || '{}');
            customTemplates[templateType] = templateContent;
            localStorage.setItem('mra_custom_templates', JSON.stringify(customTemplates));
        }

        // Method untuk memuat template custom
        loadCustomTemplate(templateType) {
            const customTemplates = JSON.parse(localStorage.getItem('mra_custom_templates') || '{}');
            return customTemplates[templateType] || null;
        }

        wrapSelectedText(textarea, wrapper) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end);
            const newText = textarea.value.substring(0, start) + wrapper + selectedText + wrapper + textarea.value.substring(end);
            textarea.value = newText;
            textarea.focus();
            textarea.setSelectionRange(start + wrapper.length, end + wrapper.length);
        }

        openWhatsAppWithTemplate(templateType = 'inti_estimasi') {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            const phoneNumbers = this.extractPhoneNumbers(this.currentDetail.telepon_customer);
            if (phoneNumbers.length === 0) {
                this.showNotification('Tidak ada nomor telepon yang valid', 'error');
                return;
            }

            const message = this.generateWhatsAppTemplateByType(this.currentDetail, templateType).replace(/<br>/g, '\n');
            const phone = phoneNumbers[0];
            this.sendWhatsApp(phone, message);
        }

        copyTemplateToClipboard(templateType = 'inti_estimasi') {
            if (!this.currentDetail) {
                this.showNotification('Pilih estimasi terlebih dahulu', 'warning');
                return;
            }

            const template = this.generateWhatsAppTemplateByType(this.currentDetail, templateType).replace(/<br>/g, '\n');
            navigator.clipboard.writeText(template).then(() => {
                this.showNotification('Template berhasil disalin!', 'success');
            });
        }

        sendWhatsApp(phone, message) {
            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
            window.open(whatsappUrl, '_blank');
        }

        extractPhoneNumbers(phoneData) {
            if (!phoneData) return [];
            const phoneNumbers = [];
            const phoneRegex = /(\d{10,})|(\(\d{10,}\))/g;
            const matches = phoneData.match(phoneRegex);
            if (matches) {
                matches.forEach(match => {
                    let cleanNumber = match.replace(/[\(\)]/g, '');
                    if (cleanNumber.startsWith('0')) {
                        cleanNumber = '62' + cleanNumber.substring(1);
                    } else if (cleanNumber.startsWith('8')) {
                        cleanNumber = '62' + cleanNumber;
                    }
                    phoneNumbers.push(cleanNumber);
                });
            }
            return phoneNumbers;
        }

        async saveFollowUp() {
            if (!this.currentDetail) return;

            try {
                const form = document.getElementById('follow-up-form');
                const formData = new FormData(form);

                const selectedSpareparts = [];
                formData.getAll('mra_selected_spareparts').forEach(index => {
                    selectedSpareparts.push(parseInt(index));
                });

                const updateData = {
                    mra_status: formData.get('mra_status'),
                    mra_catatan: formData.get('mra_catatan'),
                    mra_selected_spareparts: selectedSpareparts,
                    updated_at: new Date().toISOString()
                };

                const { error } = await supabase
                .from('estimasi')
                .update(updateData)
                .eq('id', this.currentDetail.id);

                if (error) throw error;

                this.showNotification('Follow-up berhasil disimpan!', 'success');
                await this.loadData();

            } catch (error) {
                console.error('Error saving follow-up:', error);
                this.showNotification('Error saving follow-up: ' + error.message, 'error');
            }
        }

        filterNotAcceptData(searchTerm) {
            console.log('🔍 Searching for:', searchTerm);

            // SIMPAN STATE PENCARIAN
            this.searchState.term = searchTerm;

            // ✅ LOGIKA FILTER YANG LEBIH SEDERHANA:
            // 1. Mulai dari data asli
            let dataToFilter = [...this.originalData];

            console.log('📋 Starting with all data:', dataToFilter.length);

            // 2. Terapkan filter status HANYA JIKA showAll = false
            if (!this.searchState.showAll) {
                dataToFilter = dataToFilter.filter(estimasi =>
                                                   estimasi.status === 'completed'
                                                  );
                console.log('📋 After status filter (completed only):', dataToFilter.length);
            }

            // 3. Terapkan filter tanggal jika ada
            if (this.searchState.date) {
                const filterDate = new Date(this.searchState.date);
                filterDate.setHours(0, 0, 0, 0);

                dataToFilter = dataToFilter.filter(estimasi => {
                    const estimasiDate = new Date(estimasi.created_at);
                    estimasiDate.setHours(0, 0, 0, 0);
                    return estimasiDate >= filterDate;
                });
                console.log('📅 After date filter:', dataToFilter.length);
            }

            // 4. Terapkan filter pencarian jika ada
            if (searchTerm && searchTerm.trim() !== '') {
                const term = searchTerm.toLowerCase().trim();
                dataToFilter = dataToFilter.filter(estimasi =>
                                                   (estimasi.nopol && estimasi.nopol.toLowerCase().includes(term)) ||
                                                   (estimasi.name_customer && estimasi.name_customer.toLowerCase().includes(term)) ||
                                                   (estimasi.jenis_mobil && estimasi.jenis_mobil.toLowerCase().includes(term)) ||
                                                   (estimasi.nomor_rangka && estimasi.nomor_rangka.toLowerCase().includes(term)) ||
                                                   (estimasi.telepon_customer && estimasi.telepon_customer.toLowerCase().includes(term))
                                                  );
                console.log('🔎 After search filter:', dataToFilter.length);
            }

            // ✅ OPTIMASI: Hanya render jika hasil berbeda
            const shouldRender = JSON.stringify(this.filteredData) !== JSON.stringify(dataToFilter);

            this.filteredData = dataToFilter;
            console.log('📊 Final filtered results:', this.filteredData.length, 'Should render:', shouldRender);
            console.log('👀 Show All mode:', this.searchState.showAll);

            if (shouldRender) {
                this.renderCurrentTab();
            } else {
                this.updateSearchInputValue();
            }
        }

        filterNotAcceptByDate(date) {
            console.log('📅 Filtering by date:', date);

            // SIMPAN STATE TANGGAL
            this.searchState.date = date;

            // ✅ PANGGIL filterNotAcceptData DENGAN TERM YANG ADA
            // Ini akan menerapkan semua filter (status, tanggal, pencarian) secara berurutan
            this.filterNotAcceptData(this.searchState.term);
        }

        // ... (methods untuk tab lainnya tetap sama)

        showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 6px;
                color: white;
                font-weight: 500;
                z-index: 10000;
                box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                transition: all 0.3s ease;
                max-width: 350px;
                font-size: 14px;
            `;

            const colors = {
                success: '#4caf50',
                error: '#f44336',
                info: '#2196f3',
                warning: '#ff9800'
            };

            notification.style.background = colors[type] || colors.info;
            notification.textContent = message;

            document.body.appendChild(notification);

            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }, 3000);
        }
        // --- STYLE IOS (DIMODIFIKASI) ---
        getIOSStyles() {
            return `

            <style>
            /* Tambahkan di getIOSStyles() */
.ios-input {
    /* ... existing styles ... */
    user-select: text !important; /* Pastikan text bisa diseleksi */
    -webkit-user-select: text !important;
    pointer-events: auto !important;
}

/* Prevent highlight on focus */
.ios-input:focus {
    outline: none;
    background-color: rgba(118, 118, 128, 0.2);
    /* Hilangkan outline biru di iOS */
    -webkit-tap-highlight-color: transparent;
    -webkit-appearance: none;
}
                /* Variables */
                :root {
                    --ios-bg: #F2F2F7;
                    --ios-card-bg: #FFFFFF;
                    --ios-blue: #007AFF;
                    --ios-green: #34C759;
                    --ios-red: #FF3B30;
                    --ios-gray-text: #8E8E93;
                    --ios-separator: #C6C6C8;
                    --ios-input-bg: rgba(118, 118, 128, 0.12);
                }

                .ios-container {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background-color: var(--ios-bg);
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    color: #000;
                    overflow: hidden;
                }

                /* Toolbar */
                .ios-toolbar {
                    background-color: rgba(255, 255, 255, 0.8);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border-bottom: 1px solid rgba(0,0,0,0.1);
                    padding: 12px 20px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    align-items: flex-end;
                    justify-content: space-between;
                    z-index: 10;
                    flex-shrink: 0;
                }

                .ios-form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }

                .ios-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--ios-gray-text);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                /* Inputs */
                .ios-input-wrapper {
                    position: relative;
                    width: 240px;
                }

                .ios-input {
                    background-color: var(--ios-input-bg);
                    border: none;
                    border-radius: 10px;
                    padding: 8px 12px 8px 32px;
                    font-size: 14px;
                    width: 100%;
                    box-sizing: border-box;
                    color: #000;
                    transition: background 0.2s;
                }

                .ios-input:focus {
                    outline: none;
                    background-color: rgba(118, 118, 128, 0.2);
                }

                .ios-input-icon {
                    position: absolute;
                    left: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--ios-gray-text);
                    font-size: 16px;
                }

                .ios-date-input {
                    background-color: var(--ios-input-bg);
                    border: none;
                    border-radius: 10px;
                    padding: 7px 12px;
                    font-size: 13px;
                    color: #000;
                    font-family: inherit;
                }

                /* Buttons */
                .ios-btn {
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: opacity 0.2s;
                }

                .ios-btn:active {
                    opacity: 0.7;
                }

                .ios-btn-primary {
                    background-color: var(--ios-blue);
                    color: white;
                }

                .ios-btn-success {
                    background-color: var(--ios-green);
                    color: white;
                }

                /* Toggle Switch iOS Style */
                .ios-toggle-wrapper {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                }

                .ios-toggle-input {
                    display: none;
                }

                .ios-toggle-slider {
                    position: relative;
                    width: 42px;
                    height: 24px;
                    background-color: #E9E9EA;
                    border-radius: 24px;
                    transition: .3s;
                }

                .ios-toggle-slider:before {
                    position: absolute;
                    content: "";
                    height: 20px;
                    width: 20px;
                    left: 2px;
                    bottom: 2px;
                    background-color: white;
                    border-radius: 50%;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: .3s;
                }

                .ios-toggle-input:checked + .ios-toggle-slider {
                    background-color: var(--ios-green);
                }

                .ios-toggle-input:checked + .ios-toggle-slider:before {
                    transform: translateX(18px);
                }

                .ios-toggle-label {
                    margin-left: 10px;
                    font-size: 13px;
                    font-weight: 500;
                    color: #000;
                }

                /* Table Container yang di-scroll */
                .ios-table-container {
                    flex: 1;
                    overflow: hidden;
                    padding: 20px;
                    height: calc(65vh - 90px); /* 70% tinggi layar dikurangi header */
                }

                .ios-card {
                    background: var(--ios-card-bg);
                    border-radius: 12px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                    overflow: hidden;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }

                .ios-table-wrapper {
                    overflow-y: auto;
                    overflow-x: auto;
                    flex: 1;
                    height: 100%;
                }

                .ios-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                    min-width: 1000px; /* Untuk memastikan semua kolom terlihat */
                }

                .ios-table th {
                    background-color: rgba(249, 249, 249, 0.95);
                    backdrop-filter: blur(10px);
                    position: sticky;
                    top: 0;
                    text-align: left;
                    padding: 12px 15px;
                    border-bottom: 1px solid var(--ios-separator);
                    color: var(--ios-gray-text);
                    font-weight: 600;
                    font-size: 11px;
                    text-transform: uppercase;
                    z-index: 5;
                    cursor: pointer;
                    user-select: none;
                }

                .ios-table th:hover {
                    background-color: #f0f0f0;
                }

                .ios-table td {
                    padding: 12px 15px;
                    border-bottom: 1px solid #E5E5EA;
                    color: #1C1C1E;
                }

                .ios-table tr:last-child td {
                    border-bottom: none;
                }

                .ios-table tr:hover {
                    background-color: #F2F2F7;
                }

                /* Badges */
                .ios-badge {
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    display: inline-block;
                }
                .badge-acc { background: rgba(52, 199, 89, 0.15); color: var(--ios-green); }
                .badge-blue { background: rgba(0, 122, 255, 0.15); color: var(--ios-blue); }
                .badge-gray { background: rgba(142, 142, 147, 0.15); color: var(--ios-gray-text); }
                .badge-red { background: rgba(255, 59, 48, 0.15); color: var(--ios-red); }

                /* Action Icon */
                .action-btn {
                    background: none;
                    border: none;
                    color: var(--ios-blue);
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                }
                .action-btn:hover {
                    background: rgba(0, 122, 255, 0.1);
                }

                /* Footer Info */
                .ios-footer-info {
                    padding: 10px 20px;
                    text-align: right;
                    font-size: 11px;
                    color: var(--ios-gray-text);
                    border-top: 1px solid #E5E5EA;
                    background: var(--ios-card-bg);
                    flex-shrink: 0;
                }

                /* Custom Scrollbar */
                .ios-table-wrapper::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                .ios-table-wrapper::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 4px;
                }
                .ios-table-wrapper::-webkit-scrollbar-thumb {
                    background: #c1c1c1;
                    border-radius: 4px;
                }
                .ios-table-wrapper::-webkit-scrollbar-thumb:hover {
                    background: #a8a8a8;
                }
            </style>
        `;
        }

        renderEstimasiACC(container) {
            console.log('📱 Rendering iOS Styled Tab ACC');

            // 1. Simpan nilai input sebelum render
            const oldSearchValue = this.accState?.search || '';
            const oldDateStart = this.accState?.dateStart || '';
            const oldDateEnd = this.accState?.dateEnd || '';
            const oldToggleState = this.accState?.onlyFollowedUp || false;

            // 2. Inisialisasi State jika belum ada
            if (!this.accState) {
                this.accState = {
                    search: '',
                    dateStart: '',
                    dateEnd: '',
                    onlyFollowedUp: false,
                    sortKey: 'created_at',
                    sortOrder: 'desc'
                };
                // Default tanggal: awal bulan ini sampai akhir bulan ini
                const date = new Date();
                this.accState.dateStart = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
                this.accState.dateEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
            }

            // 3. Restore nilai input jika ada
            if (oldSearchValue !== '') this.accState.search = oldSearchValue;
            if (oldDateStart !== '') this.accState.dateStart = oldDateStart;
            if (oldDateEnd !== '') this.accState.dateEnd = oldDateEnd;
            this.accState.onlyFollowedUp = oldToggleState;

            // 4. Ambil data yang sudah difilter
            const data = this.getAccFilteredData();

            // 5. Render HTML dengan ID yang konsisten
            container.innerHTML = `
        ${this.getIOSStyles()}
        <div class="ios-container">
            <div class="ios-toolbar">
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                    <div class="ios-form-group">
                        <span class="ios-label">Pencarian</span>
                        <div class="ios-input-wrapper">
                            <i class="material-icons ios-input-icon">search</i>
                            <input type="text" id="acc-search" class="ios-input"
                                value="${this.accState.search}"
                                placeholder="Nopol, Teknisi, Customer..."
                                autocomplete="off">
                        </div>
                    </div>

                    <div class="ios-form-group">
                        <span class="ios-label">Dari</span>
                        <input type="date" id="acc-date-start"
                               class="ios-date-input"
                               value="${this.accState.dateStart}"
                               autocomplete="off">
                    </div>
                    <div class="ios-form-group">
                        <span class="ios-label">Sampai</span>
                        <input type="date" id="acc-date-end"
                               class="ios-date-input"
                               value="${this.accState.dateEnd}"
                               autocomplete="off">
                    </div>

                    <div class="ios-form-group" style="justify-content: flex-end; padding-bottom: 5px;">
                        <label class="ios-toggle-wrapper">
                            <input type="checkbox" id="acc-followup-toggle" class="ios-toggle-input"
                                ${this.accState.onlyFollowedUp ? 'checked' : ''}>
                            <div class="ios-toggle-slider"></div>
                            <span class="ios-toggle-label">Sudah Follow Up</span>
                        </label>
                    </div>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button id="btn-export-excel" class="ios-btn ios-btn-success">
                        <i class="material-icons" style="font-size: 16px;">description</i> Excel
                    </button>
                    <button id="btn-report-tech" class="ios-btn ios-btn-primary">
                        <i class="material-icons" style="font-size: 16px;">analytics</i> Laporan Teknisi
                    </button>
                </div>
            </div>

            <div class="ios-table-container">
                <div class="ios-card">
                    <div class="ios-table-wrapper">
                        <table class="ios-table">
                            <thead>
                                <tr>
                                    <th>No</th>
                                    <th onclick="window.app.handleAccSort('nopol')">Nomor Polisi ${this.getSortIcon('nopol')}</th>
                                    <th onclick="window.app.handleAccSort('name_customer')">Customer ${this.getSortIcon('name_customer')}</th>
                                    <th>Telepon</th>
                                    <th>Mobil</th>
                                    <th onclick="window.app.handleAccSort('teknisi_name')">Teknisi ${this.getSortIcon('teknisi_name')}</th>
                                    <th>SA</th>
                                    <th onclick="window.app.handleAccSort('total_amount')">Total Estimasi ${this.getSortIcon('total_amount')}</th>
                                    <th onclick="window.app.handleAccSort('created_at')">Tanggal ${this.getSortIcon('created_at')}</th>
                                    <th>Status MRA</th>
                                    <th style="text-align: center;">Detail</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.renderAccTableBody(data)}
                            </tbody>
                        </table>
                    </div>
                    <div class="ios-footer-info">
                        Menampilkan <strong>${data.length}</strong> estimasi
                    </div>
                </div>
            </div>
        </div>
    `;

            // 6. Pasang Event Listeners dengan debounce untuk search
            this.attachAccEvents();
        }

        // --- HELPER UNTUK TAB ACC ---

        getSortIcon(key) {
            if (this.accState.sortKey !== key) return '';
            return this.accState.sortOrder === 'asc' ? '↑' : '↓';
        }

        renderAccTableBody(data) {
            if (data.length === 0) {
                return `<tr><td colspan="11" style="text-align: center; padding: 40px; color: #8e8e93;">Tidak ada data ditemukan</td></tr>`;
            }

            return data.map((item, index) => {
                const total = this.calculateTotalAmount(item);
                const mraBadge = this.getMraStatusBadgeIOS(item.mra_status);

                return `
                <tr style="cursor: default;">
                    <td>${index + 1}</td>
                    <td style="font-weight: 600;">${item.nopol || '-'}</td>
                    <td>${this.truncateText(item.name_customer, 20)}</td>
                    <td style="color: #8E8E93;">${item.telepon_customer || '-'}</td>
                    <td>${item.jenis_mobil || '-'}</td>
                    <td>${item.teknisi_name || '-'}</td>
                    <td>${item.service_advisor || '-'}</td>
                    <td style="font-weight: 600; color: #34C759;">Rp ${total.toLocaleString('id-ID')}</td>
                    <td style="color: #8E8E93;">${new Date(item.created_at).toLocaleDateString('id-ID')}</td>
                    <td>${mraBadge}</td>
                    <td style="text-align: center;">
                        <button class="action-btn" onclick="window.app.handleDetailClick('${item.id}')" title="Lihat Detail">
                            <i class="material-icons">visibility</i>
                        </button>
                    </td>
                </tr>
            `;
            }).join('');
        }

        // Fungsi detail yang sudah difungsikan
        handleDetailClick(id) {
            console.log('Detail clicked for ID:', id);

            // Cari data estimasi
            const estimasi = this.estimasiData.find(e => e.id === id);
            if (!estimasi) {
                this.showNotification('Data estimasi tidak ditemukan', 'error');
                return;
            }

            // Tampilkan modal detail atau navigasi ke halaman detail
            this.showDetailModal(estimasi);
        }

        showDetailModal(estimasi) {
            const total = this.calculateTotalAmount(estimasi);
            const spareparts = this.parseSpareparts(estimasi);
            const services = this.parseServices(estimasi);

            const modalContent = `
        <div style="padding: 20px; max-width: 800px; background: white; border-radius: 12px;">
            <h2 style="margin-bottom: 20px; color: #007AFF;">Detail Estimasi</h2>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">Customer</h4>
                    <p style="font-weight: 600;">${estimasi.name_customer || '-'}</p>
                </div>
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">No. Polisi</h4>
                    <p style="font-weight: 600;">${estimasi.nopol || '-'}</p>
                </div>
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">Teknisi</h4>
                    <p>${estimasi.teknisi_name || '-'}</p>
                </div>
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">Service Advisor</h4>
                    <p>${estimasi.service_advisor || '-'}</p>
                </div>
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">Total Estimasi</h4>
                    <p style="color: #34C759; font-weight: 600;">Rp ${total.toLocaleString('id-ID')}</p>
                </div>
                <div>
                    <h4 style="color: #8E8E93; margin-bottom: 5px;">Status MRA</h4>
                    ${this.getMraStatusBadgeIOS(estimasi.mra_status)}
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: #8E8E93; margin-bottom: 10px;">Spareparts</h4>
                ${spareparts.length > 0 ?
                  spareparts.map(p => `
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span>${p.name || '-'}</span>
                            <span>${p.qty || 1} x Rp ${(p.price || 0).toLocaleString('id-ID')}</span>
                        </div>
                    `).join('') :
            '<p style="color: #8E8E93;">Tidak ada spareparts</p>'
            }
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: #8E8E93; margin-bottom: 10px;">Services</h4>
                ${services.length > 0 ?
                  services.map(s => `
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span>${s.name || '-'}</span>
                            <span>${s.hour || 1} jam x Rp ${(s.price || 0).toLocaleString('id-ID')}</span>
                        </div>
                    `).join('') :
            '<p style="color: #8E8E93;">Tidak ada services</p>'
            }
            </div>

            <div style="text-align: right;">
                <button onclick="this.closest('.modal').remove()" style="padding: 8px 16px; background: #007AFF; color: white; border: none; border-radius: 8px; cursor: pointer;">Tutup</button>
            </div>
        </div>
    `;

            // Buat modal
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    `;
            modal.innerHTML = modalContent;
            document.body.appendChild(modal);

            // Close modal saat klik di luar
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        getMraStatusBadgeIOS(status) {
            const map = {
                'accepted': { label: 'ACC', class: 'badge-acc' },
                'interested': { label: 'Tertarik', class: 'badge-blue' },
                'contacted': { label: 'Dihubungi', class: 'badge-blue' },
                'not_interested': { label: 'Tdk Tertarik', class: 'badge-red' },
                'pending': { label: 'Pending', class: 'badge-gray' }
            };
            const conf = map[status] || map['pending'];
            return `<span class="ios-badge ${conf.class}">${conf.label}</span>`;
        }

        getAccFilteredData() {
            let data = [...this.estimasiData];

            // 1. Filter Search
            if (this.accState.search) {
                const term = this.accState.search.toLowerCase();
                data = data.filter(item =>
                                   (item.nopol && item.nopol.toLowerCase().includes(term)) ||
                                   (item.name_customer && item.name_customer.toLowerCase().includes(term)) ||
                                   (item.teknisi_name && item.teknisi_name.toLowerCase().includes(term)) ||
                                   (item.service_advisor && item.service_advisor.toLowerCase().includes(term))
                                  );
            }

            // 2. Filter Date
            if (this.accState.dateStart && this.accState.dateEnd) {
                const start = new Date(this.accState.dateStart);
                const end = new Date(this.accState.dateEnd);
                end.setHours(23, 59, 59);
                data = data.filter(item => {
                    const itemDate = new Date(item.created_at);
                    return itemDate >= start && itemDate <= end;
                });
            }

            // 3. Filter Only Followed Up
            if (this.accState.onlyFollowedUp) {
                data = data.filter(item =>
                                   item.mra_status &&
                                   item.mra_status !== 'pending' &&
                                   item.mra_status !== ''
                                  );
            }

            // 4. Sorting
            data.sort((a, b) => {
                let valA = a[this.accState.sortKey] || '';
                let valB = b[this.accState.sortKey] || '';

                if (this.accState.sortKey === 'total_amount') {
                    valA = this.calculateTotalAmount(a);
                    valB = this.calculateTotalAmount(b);
                }

                if (valA < valB) return this.accState.sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return this.accState.sortOrder === 'asc' ? 1 : -1;
                return 0;
            });

            return data;
        }

        calculateTotalAmount(item) {
            let total = 0;
            const spareparts = this.parseSpareparts(item);
            const services = this.parseServices(item);
            spareparts.forEach(p => total += (p.price || 0) * (p.qty || 1));
            services.forEach(s => total += (s.price || 0) * (s.hour || 1));
            return total;
        }

        handleAccSort(key) {
            if (this.accState.sortKey === key) {
                this.accState.sortOrder = this.accState.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                this.accState.sortKey = key;
                this.accState.sortOrder = 'asc';
            }
            this.renderAccTabWithoutFocusLoss(); // Ganti dari render langsung
        }

        attachAccEvents() {
            // Debounce function untuk search
            const debounce = (func, delay) => {
                let timeoutId;
                return (...args) => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => {
                        func.apply(this, args);
                    }, delay);
                };
            };

            // Search dengan debounce 300ms
            const searchInput = document.getElementById('acc-search');
            if (searchInput) {
                // Simpan posisi cursor dan selection
                let cursorPosition = searchInput.selectionStart;
                let searchValue = searchInput.value;

                // Gunakan debounce untuk menghindari re-render terlalu cepat
                const handleSearchInput = debounce((e) => {
                    this.accState.search = e.target.value;
                    this.renderAccTabWithoutFocusLoss();
                }, 300);

                searchInput.addEventListener('input', (e) => {
                    // Simpan posisi cursor sebelum debounce
                    cursorPosition = e.target.selectionStart;
                    searchValue = e.target.value;

                    handleSearchInput(e);
                });

                // Focus kembali setelah render (jika ada)
                searchInput.focus();
                if (cursorPosition >= 0) {
                    searchInput.setSelectionRange(cursorPosition, cursorPosition);
                }
            }

            // Date Filters
            const dateStartInput = document.getElementById('acc-date-start');
            if (dateStartInput) {
                dateStartInput.addEventListener('change', (e) => {
                    this.accState.dateStart = e.target.value;
                    this.renderAccTabWithoutFocusLoss();
                });
            }

            const dateEndInput = document.getElementById('acc-date-end');
            if (dateEndInput) {
                dateEndInput.addEventListener('change', (e) => {
                    this.accState.dateEnd = e.target.value;
                    this.renderAccTabWithoutFocusLoss();
                });
            }

            // Toggle Follow Up
            const toggleInput = document.getElementById('acc-followup-toggle');
            if (toggleInput) {
                toggleInput.addEventListener('change', (e) => {
                    this.accState.onlyFollowedUp = e.target.checked;
                    this.renderAccTabWithoutFocusLoss();
                });
            }

            // Buttons
            const exportExcelBtn = document.getElementById('btn-export-excel');
            if (exportExcelBtn) {
                exportExcelBtn.addEventListener('click', () => this.exportAccToExcel());
            }

            const reportTechBtn = document.getElementById('btn-report-tech');
            if (reportTechBtn) {
                reportTechBtn.addEventListener('click', () => this.generateTechnicianReport());
            }
        }

        // Method baru untuk render tab ACC tanpa kehilangan fokus
        renderAccTabWithoutFocusLoss() {
            // Debounce multiple rapid renders
            if (this.accRenderPending) return;

            this.accRenderPending = true;

            requestAnimationFrame(() => {
                // Simpan active element sebelum render
                const activeElement = document.activeElement;
                const activeId = activeElement?.id;
                const cursorPosition = activeElement?.selectionStart;
                const inputValue = activeElement?.value;

                // Render tab
                this.renderEstimasiACC(document.getElementById('content-container'));

                // Setelah render, fokus kembali
                if (activeId) {
                    setTimeout(() => {
                        const newElement = document.getElementById(activeId);
                        if (newElement) {
                            newElement.focus();

                            if (newElement.tagName === 'INPUT' || newElement.tagName === 'TEXTAREA') {
                                if (inputValue !== undefined) {
                                    // Hanya update value jika berbeda (untuk menghindari flicker)
                                    if (newElement.value !== inputValue) {
                                        newElement.value = inputValue;
                                    }
                                }
                                if (cursorPosition !== undefined && cursorPosition >= 0) {
                                    newElement.setSelectionRange(cursorPosition, cursorPosition);
                                }
                            }
                        }
                        this.accRenderPending = false;
                    }, 50);
                } else {
                    this.accRenderPending = false;
                }
            });
        }

        exportAccToExcel() {
            const data = this.getAccFilteredData();
            if (data.length === 0) {
                this.showNotification('Tidak ada data untuk diexport', 'warning');
                return;
            }

            const excelData = data.map((item, index) => {
                const spareparts = this.parseSpareparts(item);
                const services = this.parseServices(item);

                let priceSparepart = 0;
                let priceService = 0;
                const componentList = [];
                const replacedParts = [];
                const selectedIndices = item.mra_selected_spareparts || [];

                spareparts.forEach((p, idx) => {
                    priceSparepart += (p.price || 0) * (p.qty || 1);
                    componentList.push(`[Part] ${p.name}`);
                    if (selectedIndices.includes(idx)) replacedParts.push(p.name);
                });

                services.forEach(s => {
                    priceService += (s.price || 0) * (s.hour || 1);
                    componentList.push(`[Jasa] ${s.name}`);
                });

                return {
                    "No": index + 1,
                    "No Polisi": item.nopol,
                    "Nama Customer": item.name_customer,
                    "No Telepon": item.telepon_customer,
                    "Jenis Mobil": item.jenis_mobil,
                    "No Rangka": item.nomor_rangka,
                    "Teknisi": item.teknisi_name,
                    "Service Advisor": item.service_advisor,
                    "Komponen": componentList.join(', '),
                    "Harga Sparepart": priceSparepart,
                    "Harga Jasa": priceService,
                    "Total Estimasi": priceSparepart + priceService,
                    "Tanggal": new Date(item.created_at).toLocaleDateString('id-ID'),
                    "Keterangan": item.keterangan,
                    "Status Estimasi": item.status,
                    "MRA Status": item.mra_status,
                    "Catatan MRA": item.mra_catatan,
                    "Part Diganti (ACC)": replacedParts.join(', ')
                };
            });

            const ws = XLSX.utils.json_to_sheet(excelData);
            // Style lebar kolom otomatis sederhana
            const wscols = Object.keys(excelData[0]).map(k => ({ wch: 20 }));
            wscols[8] = { wch: 50 };
            ws['!cols'] = wscols;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Data Estimasi");
            XLSX.writeFile(wb, `Laporan_Estimasi_MRA_${new Date().toISOString().split('T')[0]}.xlsx`);
            this.showNotification('Excel berhasil didownload!', 'success');
        }

        // Fungsi Laporan Teknisi yang dimodifikasi
        generateTechnicianReport() {
            console.log('=== MULAI GENERATE LAPORAN 2 TABEL ===');

            const data = this.getAccFilteredData();
            console.log('1. Data estimasi:', data.length, 'records');

            // ===== DEBUG: CEK SUMBER DATA USERS =====
            console.log('\n2. DEBUG DATA SOURCE:');
            console.log('this.users ada?', !!this.users);
            console.log('this.users array?', Array.isArray(this.users));
            console.log('this.users length:', this.users?.length || 0);

            // Coba beberapa sumber data users
            let allUsers = [];

            // Sumber 1: this.users
            if (this.users && Array.isArray(this.users) && this.users.length > 0) {
                console.log('Menggunakan this.users');
                allUsers = this.users;
            }
            // Sumber 2: Global variable atau window property
            else if (window.users && Array.isArray(window.users) && window.users.length > 0) {
                console.log('Menggunakan window.users');
                allUsers = window.users;
            }
            // Sumber 3: localStorage atau sessionStorage
            else {
                try {
                    const storedUsers = localStorage.getItem('users');
                    if (storedUsers) {
                        const parsed = JSON.parse(storedUsers);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log('Menggunakan localStorage users');
                            allUsers = parsed;
                        }
                    }
                } catch (e) {
                    console.log('Tidak ada data users di localStorage');
                }
            }

            // Jika masih kosong, buat data dummy untuk testing
            if (allUsers.length === 0) {
                console.log('WARNING: Data users kosong! Menggunakan data dummy');

                // Data dummy berdasarkan log Anda sebelumnya
                allUsers = [
                    { id: '1', email: 'dzaky@example.com', full_name: 'AHMAD DZAKY ALFAARISI', role: 'teknisi' },
                    { id: '2', email: 'syafiq@example.com', full_name: 'AHMAD SYAFIQ AL-ABANI', role: 'teknisi' },
                    { id: '3', email: 'alif@example.com', full_name: 'Alif Fadhilah', role: 'teknisi' },
                    { id: '4', email: 'arya@example.com', full_name: 'Arya Prinanta', role: 'teknisi' },
                    { id: '5', email: 'daffa@example.com', full_name: "DAFFA' RIZQ RAMADAN", role: 'teknisi' },
                    { id: '6', email: 'faisal@example.com', full_name: 'Faisal', role: 'teknisi' },
                    { id: '7', email: 'ferdy@example.com', full_name: 'Ferdy Febrian', role: 'teknisi' },
                    { id: '8', email: 'heychal@example.com', full_name: 'Heychal Masyura', role: 'teknisi' },
                    { id: '9', email: 'ikhwan@example.com', full_name: 'Ikhwan Fikri Fadilah', role: 'teknisi' },
                    { id: '10', email: 'ilham@example.com', full_name: 'Ilham Riyadi', role: 'teknisi' },
                    { id: '11', email: 'fadli@example.com', full_name: 'Mochammad Fadli Falevi', role: 'teknisi' },
                    { id: '12', email: 'kevin@example.com', full_name: 'Muhammad Kevin Mapaji', role: 'teknisi' },
                    { id: '13', email: 'imam@example.com', full_name: 'Mukhsoni imam', role: 'teknisi' },
                    { id: '14', email: 'radityo@example.com', full_name: 'Radityo triandi', role: 'teknisi' },
                    { id: '15', email: 'rafi@example.com', full_name: 'RAFI ABI RIZQULLOH', role: 'teknisi' },
                    { id: '16', email: 'rahmat@example.com', full_name: 'Rahmat Pahruzi', role: 'teknisi' },
                    { id: '17', email: 'ridho@example.com', full_name: 'Ridho Wahyu Romadon', role: 'teknisi' }
                ];
            }

            console.log('3. Data users yang digunakan:', allUsers.length, 'records');
            console.log('Contoh 3 data pertama:');
            allUsers.slice(0, 3).forEach((user, i) => {
                console.log(`   ${i+1}. ID: ${user.id}, Name: "${user.full_name}", Email: ${user.email}, Role: ${user.role}`);
            });

            // Blacklist teknisi
            const blacklist = ['Faisal', 'Mukhsoni imam', 'Radityo triandi'];

            // === 1. PROSES DATA ESTIMASI UNTUK TABEL PERTAMA ===
            console.log('\n4. PROSES DATA ESTIMASI');
            const estimasiStats = {};
            const teknisiFromEstimasi = new Set();

            data.forEach((item) => {
                const techName = (item.teknisi_name || '').trim();

                if (!techName || techName.toLowerCase() === 'null') {
                    return;
                }

                // Cek blacklist
                const isBlacklisted = blacklist.some(b =>
                                                     techName.toLowerCase().includes(b.toLowerCase())
                                                    );

                if (isBlacklisted) {
                    return;
                }

                // Simpan nama untuk tracking
                teknisiFromEstimasi.add(techName.toLowerCase());

                // Proses data estimasi
                if (!estimasiStats[techName]) {
                    estimasiStats[techName] = {
                        name: techName,
                        count: 0,
                        revenue: 0,
                        potential: 0,
                        acceptedCount: 0,
                        source: 'estimasi'
                    };
                }

                const total = this.calculateTotalAmount(item);
                estimasiStats[techName].count++;
                estimasiStats[techName].potential += total;

                if (item.mra_status === 'accepted') {
                    estimasiStats[techName].revenue += total;
                    estimasiStats[techName].acceptedCount++;
                }
            });

            const estimasiArray = Object.values(estimasiStats);
            console.log('Teknisi dari estimasi:', estimasiArray.length);

            // === 2. PROSES DATA USERS UNTUK TABEL KEDUA ===
            console.log('\n5. PROSES DATA USERS UNTUK TABEL 2');

            // Filter hanya teknisi
            const teknisiUsers = allUsers.filter(user => {
                const role = (user.role || '').toLowerCase();
                return role === 'teknisi';
            });

            console.log('Total users dengan role "teknisi":', teknisiUsers.length);

            // Hanya ambil teknisi yang TIDAK ADA di estimasi
            const usersWithoutEstimasi = [];
            const usersWithEstimasi = []; // Untuk tracking saja

            teknisiUsers.forEach((user) => {
                const fullName = (user.full_name || user.name || '').trim();

                if (!fullName) {
                    return;
                }

                // Cek blacklist
                const isBlacklisted = blacklist.some(b =>
                                                     fullName.toLowerCase().includes(b.toLowerCase())
                                                    );

                if (isBlacklisted) {
                    return;
                }

                // Cek apakah user ini ada di tabel estimasi
                const isInEstimasi = teknisiFromEstimasi.has(fullName.toLowerCase());

                if (isInEstimasi) {
                    usersWithEstimasi.push({
                        id: user.id,
                        name: fullName,
                        email: user.email || '-',
                        role: user.role || '-'
                    });
                } else {
                    // Hanya tambahkan jika TIDAK ADA di estimasi
                    usersWithoutEstimasi.push({
                        id: user.id,
                        name: fullName,
                        email: user.email || '-',
                        role: user.role || '-',
                        count: 0,
                        potential: 0,
                        acceptedCount: 0,
                        contribution: 0
                    });
                }
            });

            // Urutkan berdasarkan nama
            const sortedUsersWithoutEstimasi = usersWithoutEstimasi.sort((a, b) => a.name.localeCompare(b.name));
            console.log('Teknisi TANPA estimasi (untuk tabel 2):', sortedUsersWithoutEstimasi.length);
            console.log('Teknisi DENGAN estimasi:', usersWithEstimasi.length);

            // === 3. PERHITUNGAN UNTUK TABEL 1 ===
            console.log('\n6. PERHITUNGAN KONTRIBUSI');

            const totalPotensi = estimasiArray.reduce((acc, curr) => acc + curr.potential, 0);
            console.log('Total potensi:', totalPotensi);

            estimasiArray.forEach(stat => {
                if (totalPotensi > 0) {
                    stat.contribution = (stat.potential / totalPotensi) * 100;
                } else {
                    stat.contribution = 0;
                }
            });

            // Urutkan dan beri ranking
            const sortedEstimasi = estimasiArray.sort((a, b) => b.potential - a.potential);
            sortedEstimasi.forEach((stat, index) => {
                stat.rank = index + 1;
            });

            // === 4. BUAT TABEL PDF ===
            console.log('\n7. MEMBUAT TABEL PDF');

            const docDefinition = {
                pageSize: 'A4',
                pageMargins: [40, 40, 40, 40],
                header: {
                    text: 'LAPORAN TEKNISI CR7',
                    alignment: 'center',
                    margin: [0, 15, 0, 0],
                    fontSize: 14,
                    bold: true,
                    color: '#007AFF'
                },
                content: [
                    {
                        text: `Periode: ${this.accState.dateStart} s/d ${this.accState.dateEnd}`,
                        alignment: 'center',
                        margin: [0, 0, 0, 20],
                        fontSize: 10,
                        color: '#8E8E93'
                    },

                    // ===== TABEL 1: TEKNISI DENGAN KONTRIBUSI =====
                    {
                        text: 'PERFORMANSI TEKNISI (BERDASARKAN ESTIMASI)',
                        bold: true,
                        fontSize: 11,
                        margin: [0, 0, 0, 10],
                        color: '#007AFF'
                    },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
                            body: [
                                [
                                    { text: 'Rank', fillColor: '#F2F2F7', bold: true, fontSize: 9, alignment: 'center' },
                                    { text: 'Nama Teknisi', fillColor: '#F2F2F7', bold: true, fontSize: 9 },
                                    { text: 'Jml Estimasi', fillColor: '#F2F2F7', bold: true, alignment: 'center', fontSize: 9 },
                                    { text: 'Estimasi ACC', fillColor: '#F2F2F7', bold: true, alignment: 'center', fontSize: 9 },
                                    { text: 'Total Potensi (Rp)', fillColor: '#F2F2F7', bold: true, alignment: 'right', fontSize: 9 },
                                    { text: 'Kontribusi', fillColor: '#F2F2F7', bold: true, alignment: 'right', fontSize: 9 }
                                ],
                                ...sortedEstimasi.map(stat => {
                                    const contributionText = `${stat.contribution.toFixed(1)}%`;
                                    const rankBadge = this.getRankBadge(stat.rank);

                                    return [
                                        rankBadge,
                                        { text: stat.name, fontSize: 9 },
                                        { text: stat.count, alignment: 'center', fontSize: 9 },
                                        { text: stat.acceptedCount, alignment: 'center', fontSize: 9 },
                                        {
                                            text: stat.potential.toLocaleString('id-ID'),
                                            alignment: 'right',
                                            fontSize: 9
                                        },
                                        {
                                            text: contributionText,
                                            alignment: 'right',
                                            fontSize: 9,
                                            color: stat.contribution > 10 ? '#34C759' :
                                            stat.contribution > 5 ? '#FF9500' :
                                            stat.contribution > 0 ? '#FF3B30' : '#8E8E93',
                                            bold: true
                                        }
                                    ];
                                }),
                                [
                                    {
                                        text: 'TOTAL',
                                        colSpan: 2,
                                        bold: true,
                                        fillColor: '#E5E5EA',
                                        fontSize: 9
                                    },
                                    { text: '', fillColor: '#E5E5EA' },
                                    {
                                        text: sortedEstimasi.reduce((a, b) => a + b.count, 0),
                                        bold: true,
                                        alignment: 'center',
                                        fillColor: '#E5E5EA',
                                        fontSize: 9
                                    },
                                    {
                                        text: sortedEstimasi.reduce((a, b) => a + b.acceptedCount, 0),
                                        bold: true,
                                        alignment: 'center',
                                        fillColor: '#E5E5EA',
                                        fontSize: 9
                                    },
                                    {
                                        text: totalPotensi.toLocaleString('id-ID'),
                                        bold: true,
                                        alignment: 'right',
                                        fillColor: '#E5E5EA',
                                        fontSize: 9
                                    },
                                    {
                                        text: '100%',
                                        bold: true,
                                        alignment: 'right',
                                        fillColor: '#E5E5EA',
                                        fontSize: 9
                                    }
                                ]
                            ]
                        },
                        layout: {
                            hLineWidth(i, node) {
                                return (i === 0 || i === node.table.body.length - 1) ? 1 : 0.5;
                            },
                            vLineWidth() { return 0.5; },
                            hLineColor() { return '#E5E5EA'; },
                            vLineColor() { return '#E5E5EA'; }
                        },
                        margin: [0, 0, 0, 30]
                    },

                    // ===== TABEL 2: TEKNISI BELUM KONTRIBUSI =====
                    {
                        text: 'TEKNISI BELUM KONTRIBUSI CR7',
                        bold: true,
                        fontSize: 11,
                        margin: [0, 20, 0, 10],
                        color: '#FF3B30'
                    },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', '*', 'auto', 'auto', 'auto'],
                            body: [
                                [
                                    { text: 'No', fillColor: '#FFE5E5', bold: true, fontSize: 9, alignment: 'center', color: '#FF3B30' },
                                    { text: 'Nama Teknisi', fillColor: '#FFE5E5', bold: true, fontSize: 9, color: '#FF3B30' },
                                    { text: 'Jml Estimasi', fillColor: '#FFE5E5', bold: true, alignment: 'center', fontSize: 9, color: '#FF3B30' },
                                    { text: 'Total Potensi (Rp)', fillColor: '#FFE5E5', bold: true, alignment: 'right', fontSize: 9, color: '#FF3B30' },
                                    { text: 'Kontribusi', fillColor: '#FFE5E5', bold: true, alignment: 'right', fontSize: 9, color: '#FF3B30' }
                                ],
                                // Hanya teknisi yang belum berkontribusi
                                ...(sortedUsersWithoutEstimasi.length > 0
                                    ? sortedUsersWithoutEstimasi.map((user, index) => [
                                    {
                                        text: (index + 1).toString(),
                                        fontSize: 9,
                                        alignment: 'center',
                                        color: '#8E8E93'
                                    },
                                    {
                                        text: user.name,
                                        fontSize: 9,
                                        color: '#8E8E93',
                                        italics: true
                                    },
                                    {
                                        text: '0',
                                        alignment: 'center',
                                        fontSize: 9,
                                        color: '#8E8E93'
                                    },
                                    {
                                        text: '0',
                                        alignment: 'right',
                                        fontSize: 9,
                                        color: '#8E8E93'
                                    },
                                    {
                                        text: '0%',
                                        alignment: 'right',
                                        fontSize: 9,
                                        color: '#C7C7CC',
                                        italics: true
                                    }
                                ])
                                    : [[
                                        {
                                            text: 'SEMUA TEKNISI SUDAH BERKONTRIBUSI',
                                            colSpan: 5,
                                            alignment: 'center',
                                            fontSize: 9,
                                            color: '#34C759',
                                            italics: true,
                                            bold: true
                                        },
                                        '', '', '', ''
                                    ]]
                                   ),
                                // Baris TOTAL untuk tabel 2
                                [
                                    {
                                        text: 'TOTAL',
                                        colSpan: 2,
                                        bold: true,
                                        fillColor: '#FFE5E5',
                                        fontSize: 9,
                                        color: '#FF3B30'
                                    },
                                    { text: '', fillColor: '#FFE5E5' },
                                    {
                                        text: '0',
                                        bold: true,
                                        alignment: 'center',
                                        fillColor: '#FFE5E5',
                                        fontSize: 9,
                                        color: '#FF3B30'
                                    },
                                    {
                                        text: '0',
                                        bold: true,
                                        alignment: 'right',
                                        fillColor: '#FFE5E5',
                                        fontSize: 9,
                                        color: '#FF3B30'
                                    },
                                    {
                                        text: '0%',
                                        bold: true,
                                        alignment: 'right',
                                        fillColor: '#FFE5E5',
                                        fontSize: 9,
                                        color: '#FF3B30'
                                    }
                                ]
                            ]
                        },
                        layout: {
                            hLineWidth(i, node) {
                                return (i === 0 || i === node.table.body.length - 1) ? 1 : 0.5;
                            },
                            vLineWidth() { return 0.5; },
                            hLineColor() { return '#FFCCCC'; },
                            vLineColor() { return '#FFCCCC'; }
                        },
                        margin: [0, 0, 0, 10]
                    },

                    // ===== RINGKASAN =====
                    {
                        columns: [
                            {
                                width: '50%',
                                text: [
                                    { text: 'Ringkasan Tabel 1:\n', bold: true, fontSize: 9 },
                                    `• Periode: ${this.accState.dateStart} s/d ${this.accState.dateEnd}\n`,
                                    `• Teknisi berkontribusi: ${sortedEstimasi.length}\n`,
                                    `• Total estimasi: ${sortedEstimasi.reduce((a, b) => a + b.count, 0)}\n`,
                                    `• Total potensi: Rp ${totalPotensi.toLocaleString('id-ID')}`
                        ],
                                fontSize: 8,
                                color: '#007AFF'
                            },
                            {
                                width: '50%',
                                text: [
                                    { text: 'Ringkasan Tabel 2:\n', bold: true, fontSize: 9 },
                                    `• Teknisi belum kontribusi: ${sortedUsersWithoutEstimasi.length}\n`,
                                    `• Total teknisi terdaftar: ${teknisiUsers.length}\n`,
                                    `• Persentase aktif: ${teknisiUsers.length > 0 ? ((usersWithEstimasi.length / teknisiUsers.length) * 100).toFixed(1) : 0}%\n`,
                                ],
                                fontSize: 8,
                                color: '#FF3B30'
                            }
                        ],
                        columnGap: 10,
                        margin: [0, 20, 0, 10]
                    }
                ],

                footer: function(currentPage, pageCount) {
                    return {
                        text: `Halaman ${currentPage} dari ${pageCount}`,
                        alignment: 'center',
                        fontSize: 8,
                        color: '#8E8E93',
                        margin: [0, 10, 0, 0]
                    };
                }
            };

            // Download PDF
            pdfMake.createPdf(docDefinition).download(
                `Laporan_Teknisi_CR7_${this.accState.dateStart}_${this.accState.dateEnd}.pdf`
    );

            this.showNotification('Laporan dengan 2 tabel berhasil didownload!', 'success');

            console.log('\n=== FINAL SUMMARY ===');
            console.log('Tabel 1 (Kontribusi):', sortedEstimasi.length, 'teknisi');
            console.log('Tabel 2 (Belum Kontribusi):', sortedUsersWithoutEstimasi.length, 'teknisi');
            console.log('  - Total teknisi terdaftar:', teknisiUsers.length);
            console.log('  - Aktif:', usersWithEstimasi.length);
            console.log('  - Tidak Aktif:', sortedUsersWithoutEstimasi.length);
        }

        // Helper function untuk ranking
        getRankBadge(rank) {
            let badgeStyle = {};

            switch(rank) {
                case 1:
                    badgeStyle = {
                        text: '🥇',
                        alignment: 'center',
                        fontSize: 10,
                        bold: true
                    };
                    break;
                case 2:
                    badgeStyle = {
                        text: '🥈',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                case 3:
                    badgeStyle = {
                        text: '🥉',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                default:
                    badgeStyle = {
                        text: rank.toString(),
                        alignment: 'center',
                        fontSize: 9,
                        color: '#8E8E93'
                    };
            }

            return badgeStyle;
        }

        // Helper function untuk ranking
        getRankBadge(rank) {
            let badgeStyle = {};

            switch(rank) {
                case 1:
                    badgeStyle = {
                        text: '🥇',
                        alignment: 'center',
                        fontSize: 10,
                        bold: true
                    };
                    break;
                case 2:
                    badgeStyle = {
                        text: '🥈',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                case 3:
                    badgeStyle = {
                        text: '🥉',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                default:
                    badgeStyle = {
                        text: rank.toString(),
                        alignment: 'center',
                        fontSize: 9,
                        color: '#8E8E93'
                    };
            }

            return badgeStyle;
        }

        // Helper function untuk membuat badge ranking
        getRankBadge(rank) {
            let badgeStyle = {};

            switch(rank) {
                case 1:
                    badgeStyle = {
                        text: '🥇',
                        alignment: 'center',
                        fontSize: 10,
                        bold: true
                    };
                    break;
                case 2:
                    badgeStyle = {
                        text: '🥈',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                case 3:
                    badgeStyle = {
                        text: '🥉',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                default:
                    badgeStyle = {
                        text: rank.toString(),
                        alignment: 'center',
                        fontSize: 9,
                        color: '#8E8E93'
                    };
            }

            return badgeStyle;
        }


        // Helper function untuk membuat badge ranking
        getRankBadge(rank) {
            let badgeStyle = {};

            switch(rank) {
                case 1:
                    badgeStyle = {
                        text: '1',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                case 2:
                    badgeStyle = {
                        text: '2',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                case 3:
                    badgeStyle = {
                        text: '3',
                        alignment: 'center',
                        fontSize: 10
                    };
                    break;
                default:
                    badgeStyle = {
                        text: rank.toString(),
                        alignment: 'center',
                        fontSize: 9,
                        color: '#8E8E93'
                    };
            }

            return badgeStyle;
        }
    }

    // Fungsi untuk convert URL ke base64
    function getBase64FromUrl(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                onload: function(response) {
                    const base64 = btoa(
                        new Uint8Array(response.response)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                    );
                    resolve('data:image/png;base64,' + base64);
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    // Fungsi untuk mendapatkan nomor WhatsApp
    function getWhatsAppNumber(serviceAdvisor) {
        try {
            const advisorName = String(serviceAdvisor || 'Yuliansari').trim();

            const whatsappNumbers = {
                'Abdul Azis': '087889077123',
                'Akbarudin': '085899345191',
                'Muhammad Hakiki': '081806274120',
                'Ade Purwanto': '081999704850',
                'Ahmad Baidowi': '081999704850'
            };

            let number = whatsappNumbers[advisorName];

            if (!number) {
                const keys = Object.keys(whatsappNumbers);
                const foundKey = keys.find(key =>
                                           advisorName.toLowerCase().includes(key.toLowerCase()) ||
                                           key.toLowerCase().includes(advisorName.toLowerCase())
                                          );
                number = foundKey ? whatsappNumbers[foundKey] : '087821885317';
            }

            if (typeof number !== 'string') {
                number = String(number);
            }

            number = number.replace(/\D/g, '');
            return number || '081315389866';

        } catch (error) {
            console.error('Error in getWhatsAppNumber:', error);
            return '081315389866';
        }
    }

    // Fungsi helper untuk parse komponen
    function parseKomponen(komponenData) {
        if (!komponenData) return [];

        try {
            if (typeof komponenData === 'string') {
                // Coba parse sebagai JSON
                try {
                    const parsed = JSON.parse(komponenData);
                    return Array.isArray(parsed) ? parsed : [komponenData];
                } catch (e) {
                    // Jika bukan JSON, split by comma
                    return komponenData.split(',').map(k => k.trim()).filter(k => k.length > 0);
                }
            } else if (Array.isArray(komponenData)) {
                return komponenData;
            }
        } catch (e) {
            logDebug('Error parsing komponen data:', e, 'error');
        }

        return [];
    }

    // FUNGSI HELPER UNTUK CELL DENGAN CORETAN
    function cell(text, isAcc) {
        if (isAcc) {
            return {
                text: text,
                decoration: "lineThrough",
                color: "#777"
            };
        }
        return { text: text };
    }

    async function generatePdfA5(format = 'A5') {
        try {
            if (!currentEstimasiId) {
                console.error('❌ Tidak ada currentEstimasiId');
                alert('Tidak ada data estimasi yang dipilih');
                return;
            }

            console.log('🔍 Mengambil data dari supabase...');
            const { data, error } = await supabase
            .from('estimasi')
            .select('*')
            .eq('id', currentEstimasiId)
            .single();

            if (error) {
                console.error('❌ Error dari supabase:', error);
                throw error;
            }

            console.log('✅ Data berhasil diambil:', data);
            console.log('🔍 Data foto_url:', data.foto_url);

            // Ambil data teknisi
            let teknisiNama = '-';
            if (data.teknisi_id) {
                const { data: userData, error: userError } = await supabase
                .from('users')
                .select('full_name')
                .eq('id', data.teknisi_id)
                .single();

                if (!userError && userData) {
                    teknisiNama = userData.full_name || '-';
                }
            }

            // Ambil data sparepart yang sudah di-ACC
            const selectedSpareparts = parseKomponen(data.mra_selected_spareparts || []);

            // Ambil setting diskon dari dashboard (gunakan dari app instance)
            const diskonSparepart = window.app?.diskonSettings?.sparepart || 0;
            const diskonJasa = window.app?.diskonSettings?.jasa || 0;

            // Ambil data diskon manual dari app instance
            const manualSparepart = window.app?.diskonSettings?.manualSparepart || {};
            const manualJasa = window.app?.diskonSettings?.manualJasa || {};

            // Handle sparepart dengan perhitungan total yang benar
            let sparepartData = [];
            let totalHargaSparepartNormal = 0;
            let totalHargaSparepartDiskon = 0;
            let totalHargaSparepartNonAcc = 0;

            if (data.sparepart_data) {
                if (Array.isArray(data.sparepart_data)) {
                    sparepartData = data.sparepart_data;
                } else if (typeof data.sparepart_data === 'string') {
                    try {
                        sparepartData = JSON.parse(data.sparepart_data);
                        if (!Array.isArray(sparepartData)) sparepartData = [];
                    } catch (e) {
                        sparepartData = [];
                    }
                }

                // Hitung total harga sparepart dengan diskon manual
                if (sparepartData.length > 0) {
                    sparepartData.forEach((item, index) => {
                        const itemTotal = parseFloat(item.total || item.subtotal || 0);

                        // PERBAIKAN: GUNAKAN DISKON MANUAL JIKA ADA, JIKA TIDAK GUNAKAN DISKON OTOMATIS
                        const diskonManualSparepart = manualSparepart[index];
                        const diskonAktifSparepart = diskonManualSparepart !== undefined ?
                              diskonManualSparepart : diskonSparepart;

                        const hargaSetelahDiskon = itemTotal * (1 - diskonAktifSparepart / 100);

                        // PERBAIKAN: SAMAKAN FORMAT STRING UNTUK PERBANDINGAN
                        const isAccCompleted = selectedSpareparts
                        .map(s => s.toLowerCase().trim())
                        .includes((item.name || "").toLowerCase().trim());

                        if (!isAccCompleted) {
                            totalHargaSparepartNormal += itemTotal;
                            totalHargaSparepartDiskon += hargaSetelahDiskon;
                        }
                    });

                    totalHargaSparepartNonAcc = Math.round(totalHargaSparepartDiskon);
                }
            }

            // Handle service data dengan diskon manual
            let serviceData = [];
            let totalHargaServiceNormal = 0;
            let totalHargaServiceDiskon = 0;

            if (data.service_data) {
                if (Array.isArray(data.service_data)) {
                    serviceData = data.service_data;
                } else if (typeof data.service_data === 'string') {
                    try {
                        serviceData = JSON.parse(data.service_data);
                        if (!Array.isArray(serviceData)) serviceData = [];
                    } catch (e) {
                        serviceData = [];
                    }
                }

                // Hitung total harga service dengan diskon manual
                if (serviceData.length > 0) {
                    serviceData.forEach((service, index) => {
                        const serviceTotal = parseFloat(service.total || service.subtotal || 0);

                        // PERBAIKAN: GUNAKAN DISKON MANUAL JIKA ADA, JIKA TIDAK GUNAKAN DISKON OTOMATIS
                        const diskonManualJasa = manualJasa[index];
                        const diskonAktifJasa = diskonManualJasa !== undefined ?
                              diskonManualJasa : diskonJasa;

                        const hargaSetelahDiskon = serviceTotal * (1 - diskonAktifJasa / 100);

                        totalHargaServiceNormal += serviceTotal;
                        totalHargaServiceDiskon += hargaSetelahDiskon;
                    });
                }
            }

            // Hitung total harga keseluruhan setelah diskon
            const totalHargaKeseluruhan = Math.round(totalHargaSparepartDiskon + totalHargaServiceDiskon);
            const totalDiskonSparepart = totalHargaSparepartNormal - totalHargaSparepartDiskon;
            const totalDiskonJasa = totalHargaServiceNormal - totalHargaServiceDiskon;
            const totalDiskonKeseluruhan = totalDiskonSparepart + totalDiskonJasa;

            // Handle foto URL
            let fotoArray = [];
            let fotoImages = [];
            if (data.foto_url) {
                try {
                    fotoArray = typeof data.foto_url === 'string'
                        ? JSON.parse(data.foto_url)
                    : data.foto_url;

                    if (!Array.isArray(fotoArray)) {
                        fotoArray = [];
                    }

                    // Convert foto URLs ke base64 untuk PDF
                    if (fotoArray.length > 0) {
                        for (const fotoUrl of fotoArray) {
                            try {
                                const base64Image = await getBase64FromUrl(fotoUrl);
                                fotoImages.push(base64Image);
                            } catch (error) {
                                console.error('Error converting image to base64:', error);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error parsing foto_url:', e);
                    fotoArray = [];
                }
            }

            // Dapatkan nomor WhatsApp berdasarkan Service Advisor
            const serviceAdvisor = data.service_advisor || 'Abdul Azis';
            const whatsappNumber = getWhatsAppNumber(serviceAdvisor);

            // QR admin dan icons
            const qrBase64 = await getBase64FromUrl(
                "https://pjawwektzazcxakgopou.supabase.co/storage/v1/object/public/static/qrcode.png"
            );

            const whatsappIcon = await getBase64FromUrl(
                "https://pjawwektzazcxakgopou.supabase.co/storage/v1/object/public/static/whatsapp.png"
            );

            const tunasLogo = await getBase64FromUrl(
                "https://pjawwektzazcxakgopou.supabase.co/storage/v1/object/public/static/tunas.png"
            );

            // Siapkan content PDF
            const content = [
                { text: 'Estimasi Saran Perbaikan', alignment: 'center', fontSize: 12, margin: [0, 0, 0, 12] },

                { text: `Nomor Polisi: ${data.nopol}`, fontSize: 10, margin: [0, 0, 0, 3] },
                { text: `Nomor Rangka: ${data.nomor_rangka || '-'}`, fontSize: 10, margin: [0, 0, 0, 3] },
                { text: `Nama Teknisi: ${teknisiNama}`, fontSize: 10, margin: [0, 0, 0, 3] },
                { text: `Tanggal Estimasi: ${new Date(data.created_at).toLocaleDateString('id-ID')}`, fontSize: 10, margin: [0, 0, 0, 12] }
            ];

            // INFORMASI KOMPONEN YANG SUDAH DI-ACC
            if (selectedSpareparts.length > 0) {
                content.push({
                    text: 'KOMPONEN YANG SUDAH DISETUJUI:',
                    fontSize: 9,
                    bold: true,
                    margin: [0, 0, 0, 5],
                    color: '#e60000'
                });

                content.push({
                    text: selectedSpareparts.join(', '),
                    fontSize: 8,
                    margin: [0, 0, 0, 10]
                });
            }

            // Helper function untuk cell dengan styling ACC - PERBAIKAN: Hapus 'none' decoration
            function createCell(text, isAccCompleted = false) {
                if (isAccCompleted) {
                    return {
                        text: text,
                        decoration: 'lineThrough',
                        color: '#e60000'
                    };
                } else {
                    return { text: text };
                }
            }

            // Tambahkan tabel sparepart jika ada data
            if (sparepartData.length > 0) {
                // Tentukan apakah ada diskon untuk menentukan struktur kolom
                const manualSparepartCount = Object.keys(manualSparepart).length;
                const adaDiskon = diskonSparepart > 0 || manualSparepartCount > 0;

                const sparepartHeader = adaDiskon ?
                      [
                          { text: 'Nama Barang', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga Normal', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Disc', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga Setelah Disc', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Part', fillColor: '#2196F3', color: 'white', bold: true }
                      ] : [
                          { text: 'Nama Barang', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Jml', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Total', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Part', fillColor: '#2196F3', color: 'white', bold: true }
                      ];

                const sparepartBody = [sparepartHeader];

                // Tambahkan baris data sparepart
                sparepartData.forEach((item, index) => {
                    let avail = '-';
                    if (item.availability) {
                        const val = item.availability.toLowerCase();
                        if (val === 'ada') avail = 'Ada';
                        else if (val === 'kosong') avail = 'N/A';
                        else if (val === 'bo') avail = 'BO';
                        else if (val === 'tam') avail = 'TAM';
                    }

                    // Potong hanya 3 karakter untuk kolom part
                    avail = avail.substring(0, 3);

                    const isAccCompleted = selectedSpareparts
                    .map(s => s.toLowerCase().trim())
                    .includes((item.name || "").toLowerCase().trim());

                    // Hitung harga dengan diskon yang aktif
                    const itemTotal = parseFloat(item.total || item.subtotal || 0);
                    const diskonManualSparepart = manualSparepart[index];
                    const diskonAktifSparepart = diskonManualSparepart !== undefined ?
                          diskonManualSparepart : diskonSparepart;
                    const hargaSetelahDiskon = itemTotal * (1 - diskonAktifSparepart / 100);

                    if (adaDiskon) {
                        // Format dengan diskon
                        const namaBarangText = `${truncateText(item.name, 25) || '-'} (x${item.qty || 1})`;

                        // PERBAIKAN: Harga normal HARUS dicoret jika ada diskon, terlepas dari status ACC
                        const hargaNormalStyle = diskonAktifSparepart > 0 ? {
                            text: formatRupiah(itemTotal),
                            decoration: 'lineThrough', // SELALU coret jika ada diskon
                            color: '#666666'
                        } : {
                            text: formatRupiah(itemTotal),
                            color: isAccCompleted ? '#e60000' : 'black'
                        };

                        sparepartBody.push([
                            createCell(namaBarangText, isAccCompleted),
                            hargaNormalStyle,
                            {
                                text: diskonAktifSparepart > 0 ? `-${diskonAktifSparepart}%` : '-',
                                color: diskonAktifSparepart > 0 ? '#e60000' : 'black'
                            },
                            {
                                text: formatRupiah(Math.round(hargaSetelahDiskon)),
                                color: isAccCompleted ? '#e60000' : '#2e7d32',
                                bold: diskonAktifSparepart > 0
                            },
                            createCell(avail, isAccCompleted)
                        ]);
                    } else {
                        // Format tanpa diskon (seperti sebelumnya)
                        sparepartBody.push([
                            createCell(truncateText(item.name, 25) || '-', isAccCompleted),
                            createCell(formatRupiah(item.price || 0), isAccCompleted),
                            createCell(item.qty || 1, isAccCompleted),
                            createCell(formatRupiah(itemTotal), isAccCompleted),
                            createCell(avail, isAccCompleted)
                        ]);
                    }
                });
                // Baris total sparepart - PERBAIKAN: SELARASKAN DENGAN KOLOM TOTAL
                if (adaDiskon) {
                    // Jika ada diskon, tampilkan total setelah diskon - lurus dengan kolom "Harga Setelah Disc"
                    sparepartBody.push([
                        { text: 'Total Harga Sparepart', colSpan: 3, alignment: 'right', bold: true }, {}, {},
                        { text: formatRupiah(totalHargaSparepartDiskon), bold: true, color: '#2e7d32' },
                        '' // Kolom part kosong untuk baris total
                    ]);
                } else {
                    // Jika tidak ada diskon, tampilkan total normal - lurus dengan kolom "Total"
                    sparepartBody.push([
                        { text: 'Total Harga Sparepart', colSpan: 3, alignment: 'right', bold: true }, {}, {},
                        { text: formatRupiah(totalHargaSparepartNormal), bold: true },
                        '' // Kolom part kosong untuk baris total
                    ]);
                }

                // PERBAIKAN: ATUR LEBAR KOLOM YANG LEBIH PROPORSIONAL
                const tableWidths = adaDiskon ?
                      ['*', 'auto', 'auto', 'auto', 25] : // Kolom part hanya 25pt
                ['*', 'auto', 'auto', 'auto', 25];  // Kolom part hanya 25pt

                content.push({
                    table: {
                        widths: tableWidths,
                        body: sparepartBody
                    },
                    fontSize: 9,
                    margin: [0, 0, 0, 12]
                });


                // TAMBAHKAN NOTES JIKA ADA DISKON
                if (adaDiskon) {
                    const notes_harga = [
                        { text: '*Harga normal yang tertulis sudah di kalikan dengan jumlah part', fontSize: 8, italics: true, margin: [0, 0, 0, 2] }
                    ];
                    content.push(...notes_harga);
                    content.push({ text: '', margin: [0, 0, 0, 8] }); // Tambahkan spasi setelah notes
                }
            }

            // Tambahkan tabel service jika ada data
            if (serviceData.length > 0) {
                const manualJasaCount = Object.keys(manualJasa).length;
                const adaDiskonJasa = diskonJasa > 0 || manualJasaCount > 0;

                const serviceHeader = adaDiskonJasa ?
                      [
                          { text: 'Jenis Service', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga Normal', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Disc', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga Setelah Disc', fillColor: '#2196F3', color: 'white', bold: true }
                      ] : [
                          { text: 'Jenis Service', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Jam', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Harga/Jam', fillColor: '#2196F3', color: 'white', bold: true },
                          { text: 'Total', fillColor: '#2196F3', color: 'white', bold: true }
                      ];

                const serviceBody = [serviceHeader];

                serviceData.forEach((service, index) => {
                    // Hitung harga dengan diskon yang aktif
                    const serviceTotal = parseFloat(service.total || service.subtotal || 0);
                    const diskonManualJasa = manualJasa[index];
                    const diskonAktifJasa = diskonManualJasa !== undefined ?
                          diskonManualJasa : diskonJasa;
                    const hargaSetelahDiskon = serviceTotal * (1 - diskonAktifJasa / 100);

                    if (adaDiskonJasa) {
                        // Format dengan diskon untuk jasa
                        serviceBody.push([
                            { text: truncateText(service.desc || '-', 30) },
                            {
                                text: formatRupiah(serviceTotal),
                                decoration: 'lineThrough',
                                color: '#666666'
                            },
                            {
                                text: diskonAktifJasa > 0 ? `-${diskonAktifJasa}%` : '-',
                                color: diskonAktifJasa > 0 ? '#e60000' : 'black'
                            },
                            {
                                text: formatRupiah(Math.round(hargaSetelahDiskon)),
                                color: '#2e7d32',
                                bold: diskonAktifJasa > 0
                            }
                        ]);
                    } else {
                        // Format tanpa diskon untuk jasa
                        serviceBody.push([
                            { text: truncateText(service.desc || '-', 30) },
                            { text: service.hour || service.jam || 0 },
                            { text: formatRupiah(service.price || service.harga || 0) },
                            { text: formatRupiah(serviceTotal) }
                        ]);
                    }
                });

                // Baris total service
                if (adaDiskonJasa) {
                    serviceBody.push([
                        { text: 'Total Harga Service', colSpan: 3, alignment: 'right', bold: true }, {}, {},
                        { text: formatRupiah(totalHargaServiceDiskon), bold: true, color: '#2e7d32' }
                    ]);
                } else {
                    serviceBody.push([
                        { text: 'Total Harga Service', colSpan: 3, alignment: 'right', bold: true }, {}, {},
                        { text: formatRupiah(totalHargaServiceNormal), bold: true }
                    ]);
                }

                const serviceWidths = adaDiskonJasa ?
                      ['*', 'auto', 'auto', 'auto'] :
                ['*', 'auto', 'auto', 'auto'];

                content.push({
                    table: {
                        widths: serviceWidths,
                        body: serviceBody
                    },
                    fontSize: 9,
                    margin: [0, 0, 0, 12]
                });
            }

            // Tambahkan RINGKASAN FINAL
            const ringkasanBody = [];

            if (totalDiskonKeseluruhan > 0) {
                // Jika ada diskon, tampilkan normal, diskon, dan setelah diskon
                ringkasanBody.push([
                    { text: 'Total Harga Normal', alignment: 'right', bold: true },
                    { text: formatRupiah(totalHargaSparepartNormal + totalHargaServiceNormal), bold: true }
                ]);

                ringkasanBody.push([
                    { text: 'Total Diskon', alignment: 'right', color: '#e60000' },
                    { text: `- ${formatRupiah(totalDiskonKeseluruhan)}`, color: '#e60000' }
                ]);

                ringkasanBody.push([
                    { text: 'TOTAL HARGA SETELAH DISKON', alignment: 'right', bold: true, fontSize: 11 },
                    { text: formatRupiah(totalHargaKeseluruhan), bold: true, fontSize: 11, color: '#4caf50' }
                ]);
            } else {
                // Jika tidak ada diskon, tampilkan hanya "TOTAL HARGA" saja
                ringkasanBody.push([
                    { text: 'TOTAL HARGA', alignment: 'right', bold: true, fontSize: 11 },
                    { text: formatRupiah(totalHargaKeseluruhan), bold: true, fontSize: 11, color: '#4caf50' }
                ]);
            }

            content.push({
                table: {
                    widths: ['*', 'auto'],
                    body: ringkasanBody
                },
                margin: [0, 0, 0, 12]
            });

            // Tambahkan gambar jika ada
            if (fotoImages.length > 0) {
                content.push({
                    text: 'Foto Estimasi:',
                    fontSize: 10,
                    bold: true,
                    margin: [0, 10, 0, 5]
                });

                // Grid 3 kolom responsif dengan margin minimal
                const fotoPerBaris = 3;
                const rows = [];

                for (let i = 0; i < fotoImages.length; i += fotoPerBaris) {
                    const rowImages = fotoImages.slice(i, i + fotoPerBaris);

                    // masing-masing gambar proporsional
                    const columns = rowImages.map(img => ({
                        image: img,
                        fit: [180, 145], // sedikit lebih besar agar memenuhi lebar halaman
                        alignment: 'center',
                        margin: [2, 0, 2, 0] // sedikit jarak antar gambar
                    }));

                    // jika jumlah gambar < 3, tambahkan kolom kosong agar tetap sejajar
                    while (columns.length < fotoPerBaris) {
                        columns.push({ text: '', width: '*' });
                    }

                    rows.push({
                        columns: columns,
                        columnGap: 6, // jarak antar kolom kecil saja
                        margin: [0, 0, 0, 6]
                    });
                }

                content.push(...rows);
                content.push({ text: '', margin: [0, 0, 0, 10] });
            }

            // Tambahkan keterangan dan footer notes
            const notes = [
                { text: '*Harga dapat berubah sewaktu-waktu tanpa pemberitahuan', fontSize: 8, italics: true, margin: [0, 0, 0, 2] },
                { text: '*Ada (Dapat dilakukan penggantian), TAM (Order 3 hari), BO (Order 1 bulan), N/A (berhenti produksi)', fontSize: 8, italics: true, margin: [0, 0, 0, 2] }
            ];

            // Tambahan informasi tentang perhitungan harga
            if (selectedSpareparts.length > 0) {
                notes.push(
                    {
                        text: '*Item bergaris coret adalah komponen yang sudah disetujui dan tidak termasuk dalam total harga',
                        fontSize: 8,
                        italics: true,
                        margin: [0, 0, 0, 2],
                        color: '#e60000'
                    }
                );
            }

            notes.push({
                text: `Keterangan: ${data.keterangan || 'Tidak ada keterangan tambahan'}`,
                fontSize: 10,
                margin: [0, 8, 0, 0]
            });

            content.push(...notes);

            // PERBAIKAN GARIS HEADER - Hilangkan whitespace tidak seimbang
            const docDefinition = {
                pageSize: 'A5',
                pageMargins: [20, 80, 20, 80],

                header: {
                    margin: [20, 20, 20, 10],
                    stack: [
                        {
                            columns: [
                                {
                                    width: 'auto',
                                    image: tunasLogo,
                                    fit: [25, 25],
                                    margin: [0, 0, 8, 0]
                                },
                                {
                                    width: '*',
                                    stack: [
                                        { text: 'Tunas Toyota Batutulis', fontSize: 14, bold: true, color: '#e60000' },
                                        { text: 'Jl. Batutulis Raya No. 42, Jakarta Pusat', fontSize: 10 },
                                        { text: 'Telp: (021) 3454465', fontSize: 9 }
                                    ],
                                    alignment: 'left'
                                }
                            ]
                        },
                        {
                            margin: [0, 8, 0, 0],
                            canvas: [
                                {
                                    type: 'line',
                                    x1: 0,
                                    y1: 0,
                                    x2: 515, // SESUAIKAN DENGAN LEBAR HALAMAN A5
                                    y2: 0,
                                    lineWidth: 1,
                                    color: '#e60000'
                                }
                            ]
                        }
                    ]
                },

                footer: function (currentPage, pageCount) {
                    const advisorName = data.service_advisor || 'Abdul Azis';
                    const whatsappNum = getWhatsAppNumber(advisorName);

                    return {
                        margin: [20, 10, 20, 10],
                        stack: [
                            {
                                columns: [
                                    {
                                        width: '*',
                                        stack: [
                                            {
                                                text: `Hubungi ${advisorName} untuk melakukan perbaikan:`,
                                                bold: true,
                                                fontSize: 10
                                            },
                                            {
                                                margin: [0, 2, 0, 0],
                                                columns: [
                                                    {
                                                        width: 12,
                                                        image: whatsappIcon,
                                                        fit: [10, 10],
                                                        margin: [0, 0, 6, 0]
                                                    },
                                                    {
                                                        width: '*',
                                                        text: whatsappNum,
                                                        fontSize: 10,
                                                        color: '#25D366'
                                                    }
                                                ]
                                            },
                                            {
                                                text: `Service Advisor Tunas Toyota Batutulis`,
                                                fontSize: 8,
                                                color: '#666',
                                                margin: [0, 4, 0, 0]
                                            }
                                        ]
                                    },
                                    {
                                        width: 60,
                                        image: qrBase64,
                                        fit: [50, 50]
                                    }
                                ]
                            },
                            {
                                margin: [0, 5, 0, 0],
                                columns: [
                                    {
                                        width: '*',
                                        text: `Dicetak pada: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`,
                                        fontSize: 8,
                                        color: '#6c757d',
                                        alignment: 'left'
                                    },
                                    {
                                        width: 50,
                                        text: currentPage.toString() + ' / ' + pageCount,
                                        fontSize: 8,
                                        alignment: 'right'
                                    }
                                ]
                            }
                        ]
                    };
                },

                content: content
            };

            // Download PDF
            pdfMake.createPdf(docDefinition).download(`estimasi_${data.nopol}_${new Date().getTime()}.pdf`);

        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Terjadi kesalahan saat membuat PDF: ' + error.message);
        }
    }
    //latest
    function formatRupiah(amount) {
        return 'Rp ' + parseInt(amount).toLocaleString('id-ID');
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    // Add CSS styles
    const style = document.createElement('style');
    style.textContent = `
     /* CSS untuk scroll horizontal foto - FIXED WIDTH */
    .foto-container-wrapper {
        position: relative;
        width: 100%;
        overflow: hidden;
    }

    #foto-scroll-container {
        scrollbar-width: thin;
        scrollbar-color: #c1c1c1 #f1f1f1;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
    }

    #foto-scroll-container::-webkit-scrollbar {
        height: 6px;
    }

    #foto-scroll-container::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 3px;
        margin: 0 10px;
    }

    #foto-scroll-container::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 3px;
    }

    #foto-scroll-container::-webkit-scrollbar-thumb:hover {
        background: #a8a8a8;
    }

    .foto-thumbnail {
        transition: all 0.3s ease;
        border-radius: 8px;
        flex-shrink: 0;
    }

    .foto-thumbnail:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .foto-thumbnail:hover img {
        border-color: #1e3c72 !important;
    }

    /* Gradient overlay untuk scroll indication */
    .scroll-gradient-right {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 30px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9));
        pointer-events: none;
    }

    .scroll-gradient-left {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: 30px;
        background: linear-gradient(270deg, transparent, rgba(255,255,255,0.9));
        pointer-events: none;
        display: none;
    }

    /* Style untuk tombol navigasi foto */
    .btn-small {
        background: #e9ecef;
        color: #495057;
        border: none;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .btn-small:hover {
        background: #dee2e6;
        transform: translateY(-1px);
    }

    .tabs-hidden {
        height: 0 !important;
        overflow: hidden !important;
        margin-bottom: 0 !important;
    }

    /* Pastikan container detail tidak berubah ukuran */
    #detail-content-left {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
    }

    .panel-colored {
        width: 100%;
        box-sizing: border-box;
    }
        .compact-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        .compact-table th {
            background: #f8f9fa;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #333;
            border-bottom: 1px solid #e0e0e0;
            position: sticky;
            top: 0;
            font-size: 13px;
        }
        .compact-table td {
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
        }
        .compact-table tr:hover {
            background: #f8f9fa;
        }
        .btn-primary {
            background: #1e3c72;
            color: white;
            border: none;
            padding: 12px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            transition: background 0.2s ease;
        }
        .btn-primary:hover {
            background: #2a5298;
        }
        .btn-secondary {
            background: #6c757d;
            color: white;
            border: none;
            padding: 12px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            transition: background 0.2s ease;
        }
        .btn-secondary:hover {
            background: #545b62;
        }
        .btn-small {
            background: #e9ecef;
            color: #495057;
            border: none;
            padding: 8px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-small:hover {
            background: #dee2e6;
        }
        .btn-large {
            background: #e9ecef;
            color: #495057;
            border: none;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-large:hover {
            background: #dee2e6;
        }
        .space-y-4 > * {
            margin-bottom: 16px;
        }
        .space-y-4 > *:last-child {
            margin-bottom: 0;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #a8a8a8;
        }

        /* Input focus styles */
        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #1e3c72 !important;
            box-shadow: 0 0 0 2px rgba(30, 60, 114, 0.1) !important;
        }
    `;
    document.head.appendChild(style);

    // Load Material Icons
    const materialIcons = document.createElement('link');
    materialIcons.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    materialIcons.rel = 'stylesheet';
    document.head.appendChild(materialIcons);

    // Initialize app
    new MRAFollowUpApp();
})();
