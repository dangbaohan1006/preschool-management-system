/// <reference types="@cloudflare/workers-types" />
// FinanceService Handles fees, billing, and payments.
// Adheres to SRP (Finance logically separated from attendance)

export class FinanceService {
    constructor(private db: D1Database) { }

    async getFeeCategories() {
        const { results } = await this.db.prepare('SELECT * FROM dim_fee_categories ORDER BY group_id, name').all();
        return results;
    }

    async upsertFeeCategory(data: { id: string; name: string; default_amount: number; is_refundable: number; group_id?: string, type?: string }) {
        return await this.db.prepare(
            'INSERT OR REPLACE INTO dim_fee_categories (id, name, default_amount, is_refundable, group_id, type) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(data.id, data.name, data.default_amount, data.is_refundable, data.group_id || 'STANDARD', data.type || 'FIXED').run();
    }

    async deleteFeeCategory(id: string) {
        // Check if category is used in any billing items
        const used = await this.db.prepare('SELECT id FROM fact_billing_items WHERE category_id = ? LIMIT 1').bind(id).first();
        if (used) throw new Error('Không thể xóa loại phí đang có trong hóa đơn học sinh');

        return await this.db.prepare('DELETE FROM dim_fee_categories WHERE id = ?').bind(id).run();
    }

    // 2. Quản lý kỳ kế toán
    async getFinancialPeriods() {
        const { results } = await this.db.prepare('SELECT * FROM dim_financial_periods ORDER BY period_month DESC').all();
        return results;
    }

    async setPeriodStatus(month: string, status: 'OPEN' | 'CLOSED', user: string) {
        if (status === 'CLOSED') {
            return await this.db.prepare(
                'UPDATE dim_financial_periods SET status = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE period_month = ?'
            ).bind(status, user, month).run();
        }
        return await this.db.prepare(
            'UPDATE dim_financial_periods SET status = ? WHERE period_month = ?'
        ).bind(status, month).run();
    }

    // 3. Quản lý hóa đơn (Billing)
    async getMonthlyBills(month: string, classId?: string) {
        let query = `
            SELECT b.*, s.name as student_name, c.name as class_name, s.discount_percent
            FROM fact_monthly_billing b
            JOIN students s ON b.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            WHERE b.period_month = ?
        `;
        if (classId) query += ' AND s.class_id = ?';

        const stmt = this.db.prepare(query);
        const { results } = await (classId ? stmt.bind(month, classId).all() : stmt.bind(month).all());
        return results;
    }

    private evaluateFormula(formula: string, variables: Record<string, number>): number {
        let processed = formula;

        const lowerVars: Record<string, number> = {};
        for (const [k, v] of Object.entries(variables)) {
            lowerVars[k.toLowerCase()] = v;
        }

        // 1. Thay thế biến
        processed = processed.replace(/\[(.*?)\]/g, (match, name) => {
            const key = name.trim().toLowerCase();
            return lowerVars.hasOwnProperty(key) ? lowerVars[key].toString() : '0';
        });

        processed = processed.replace(/\{\{(.*?)\}\}/g, (match, name) => {
            const key = name.trim().toLowerCase();
            return lowerVars.hasOwnProperty(key) ? lowerVars[key].toString() : '0';
        });

        // 2. Làm sạch chuỗi
        const sanitized = processed.replace(/[^0-9+\-*/(). ]/g, '');
        if (!sanitized.trim()) return 0;

        // 3. Sử dụng trình tính toán thủ công đơn giản (Simple Math Evaluator)
        // Vì không được dùng eval, ta sẽ xử lý các phép tính cơ bản
        try {
            return this.simpleSolve(sanitized);
        } catch (e) {
            console.error('Formula evaluation error:', formula, sanitized, e);
            return 0;
        }
    }

    private simpleSolve(expr: string): number {
        const clean = expr.replace(/\s+/g, '');
        try {
            return this.evalArithmetic(clean);
        } catch (e) { return 0; }
    }

    private evalArithmetic(fn: string): number {
        // Sử dụng một trick nhỏ: Tách các cụm số và toán tử
        // Vì công thức phí thường đơn giản: A + B * (C - D)
        // Ta sẽ dùng giải pháp an toàn hơn là Regex Tokenizer
        const tokens = fn.match(/\d+\.?\d*|[\+\-\*\/\(\)]/g);
        if (!tokens) return 0;

        let pos = 0;
        const parseExpr = (): number => {
            let res = parseTerm();
            while (tokens[pos] === '+' || tokens[pos] === '-') {
                const op = tokens[pos++];
                const next = parseTerm();
                res = op === '+' ? res + next : res - next;
            }
            return res;
        };
        const parseTerm = (): number => {
            let res = parseFactor();
            while (tokens[pos] === '*' || tokens[pos] === '/') {
                const op = tokens[pos++];
                const next = parseFactor();
                res = op === '*' ? res * next : res / next;
            }
            return res;
        };
        const parseFactor = (): number => {
            if (tokens[pos] === '(') {
                pos++;
                const res = parseExpr();
                pos++; // skip )
                return res;
            }
            return parseFloat(tokens[pos++]);
        };
        return parseExpr();
    }

    async createBill(data: { id: string, student_id: string, period_month: string }) {
        const student = await this.db.prepare('SELECT s.*, c.type as class_type, c.surcharge_amount, c.surcharge_note FROM students s LEFT JOIN classes c ON s.class_id = c.id WHERE s.id = ?').bind(data.student_id).first<any>();
        if (!student) throw new Error('Student not found');

        const settings = await this.db.prepare('SELECT key, value FROM app_settings WHERE key IN ("billing_std_days", "billing_formula", "billing_formula_annual")').all<{ key: string, value: string }>();
        const formula = settings.results.find(s => s.key === 'billing_formula')?.value || '';
        const formulaAnnual = settings.results.find(s => s.key === 'billing_formula_annual')?.value || '';

        // Calculate dynamic STANDARD_DAYS based on calendar and holidays
        const [year, monthNum] = data.period_month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();
        const holidaysRes = await this.db.prepare('SELECT holiday_date FROM dim_holidays WHERE holiday_date LIKE ?').bind(`${data.period_month}%`).all<{ holiday_date: string }>();
        const holidaySet = new Set((holidaysRes.results || []).map(h => h.holiday_date));

        let stdDays = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, monthNum - 1, d);
            const dayOfWeek = dateObj.getDay(); 
            const dateString = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            
            // Standard: Monday to Friday (1-5). Sunday (0) is off. 
            // We'll check if Saturday (6) is off too based on the setting default of 22.
            // If they have 22 days, it's Mon-Fri. If 26, it's Mon-Sat.
            const defaultStdDays = parseInt(settings.results.find(s => s.key === 'billing_std_days')?.value || '22');
            const isSaturdayWorking = defaultStdDays > 23; 

            const isWeekend = dayOfWeek === 0 || (dayOfWeek === 6 && !isSaturdayWorking);
            if (!isWeekend && !holidaySet.has(dateString)) {
                stdDays++;
            }
        }

        const { count: absent_count } = await this.db.prepare('SELECT COUNT(*) as count FROM Raw_Attendance WHERE student_id = ? AND date LIKE ? AND (status = "ABSENT" OR status = "TRANSFER")')
            .bind(data.student_id, `${data.period_month}%`).first<{ count: number }>() || { count: 0 };

        const feeCatsRes = await this.db.prepare('SELECT * FROM dim_fee_categories').all<any>();
        const allFeeCats = feeCatsRes.results || [];
        const includeAnnual = (await this.db.prepare('SELECT include_annual FROM fact_monthly_billing WHERE id = ?').bind(data.id).first<any>())?.include_annual || 0;

        // 1. CHUẨN BỊ BIẾN SỐ (TRẢ VỀ ĐƠN GIÁ GỐC - ĐỂ USER TỰ NHÂN TRONG CÔNG THỨC)
        const variables: Record<string, number> = {
            'STANDARD_DAYS': stdDays,
            'ABSENT_DAYS': absent_count,
            'Số ngày chuẩn': stdDays,
            'Số ngày vắng': absent_count,
            'Phụ thu': student.surcharge_amount || 0
        };

        // Chống trùng lặp theo tên (Ưu tiên nhóm của học sinh)
        const feeCatsMap: Record<string, any> = {};
        const targetGroup = student.class_type || 'STANDARD';
        allFeeCats.forEach(cat => {
            if (!feeCatsMap[cat.name] || cat.group_id === targetGroup) {
                feeCatsMap[cat.name] = cat;
            }
        });

        Object.values(feeCatsMap).forEach((cat: any) => {
            variables[cat.name] = cat.default_amount;
        });

        // 2. TÍNH TỔNG THEO CÔNG THỨC (PHÉP TÍNH DUY NHẤT)
        let totalAmount = this.evaluateFormula(formula, variables) + (includeAnnual ? this.evaluateFormula(formulaAnnual, variables) : 0);
        const rawTotalBeforeDiscount = totalAmount;

        // 3. TẠO CÁC MỤC HÓA ĐƠN
        const itemsToInsert = [];

        // Apply student-level persistent discount if any
        if (student.discount_percent > 0) {
            const discountVal = Math.round(rawTotalBeforeDiscount * student.discount_percent / 100);
            totalAmount -= discountVal;
            itemsToInsert.push(
                this.db.prepare('INSERT OR REPLACE INTO fact_billing_items (id, billing_id, category_id, amount, quantity, total, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .bind(`${data.id}_DISCOUNT`, data.id, 'DISCOUNT', -discountVal, 1, -discountVal, `Chiết khấu cố định (${student.discount_percent}%)`)
            );
            // Ensure DISCOUNT category exists
            await this.db.prepare('INSERT OR IGNORE INTO dim_fee_categories (id, name, default_amount, group_id) VALUES ("DISCOUNT", "Chiết khấu học phí", 0, "SYSTEM")').bind().run();
        }

        // 3. TẠO CÁC MỤC HÓA ĐƠN (Tiếp tục)
        let itemsSum = 0;
        let totalRefund = 0;

        Object.values(feeCatsMap).forEach((cat: any) => {
            const inMonthly = formula.toLowerCase().includes(`[${cat.name.toLowerCase()}]`);
            const inAnnual = formulaAnnual.toLowerCase().includes(`[${cat.name.toLowerCase()}]`);

            if (inMonthly || (inAnnual && includeAnnual)) {
                let qty = 1;
                let itemTotal = cat.default_amount;

                // Logic hiển thị item: Nếu là phí ăn uống/hoàn tiền, hiển thị giá trị net tương tự như công thức thường dùng
                if (cat.type === 'ABSENT_REFUND' || cat.is_refundable) {
                    qty = stdDays;
                    const refund = absent_count * cat.default_amount;
                    itemTotal = (stdDays * cat.default_amount) - refund;
                    totalRefund += refund;
                }

                itemsSum += itemTotal;
                itemsToInsert.push(
                    this.db.prepare('INSERT OR REPLACE INTO fact_billing_items (id, billing_id, category_id, amount, quantity, total) VALUES (?, ?, ?, ?, ?, ?)')
                        .bind(`${data.id}_${cat.id}`, data.id, cat.id, cat.default_amount, qty, itemTotal)
                );
            }
        });

        if (student.surcharge_amount > 0 && formula.toLowerCase().includes('[phụ thu]')) {
            itemsSum += student.surcharge_amount;
            itemsToInsert.push(
                this.db.prepare('INSERT OR REPLACE INTO fact_billing_items (id, billing_id, category_id, amount, quantity, total, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .bind(`${data.id}_SURCHARGE`, data.id, 'SURCHARGE', student.surcharge_amount, 1, student.surcharge_amount, student.surcharge_note)
            );
        }

        const diff = totalAmount - itemsSum;
        if (Math.abs(diff) >= 1) {
            itemsToInsert.push(
                this.db.prepare('INSERT OR REPLACE INTO fact_billing_items (id, billing_id, category_id, amount, quantity, total, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .bind(`${data.id}_ADJUST`, data.id, 'SURCHARGE', diff, 1, diff, 'Điều chỉnh theo hằng số công thức')
            );
        }

        const billingStmt = this.db.prepare(
            'INSERT OR REPLACE INTO fact_monthly_billing (id, student_id, period_month, base_amount, refund_amount, extra_amount, total_amount, include_annual) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(data.id, data.student_id, data.period_month, 0, totalRefund, 0, totalAmount, includeAnnual);

        const prepStmts = [
            this.db.prepare('DELETE FROM fact_billing_items WHERE billing_id = ?').bind(data.id),
            this.db.prepare('INSERT OR IGNORE INTO dim_financial_periods (period_month, status) VALUES (?, "OPEN")').bind(data.period_month),
            this.db.prepare('INSERT OR IGNORE INTO dim_fee_categories (id, name, default_amount, group_id) VALUES ("SURCHARGE", "Phụ thu/Điều chỉnh", 0, "SYSTEM")').bind()
        ];

        return await this.db.batch([...prepStmts, billingStmt, ...itemsToInsert]);
    }

    async toggleAnnualSubscription(billingId: string, include: boolean) {
        await this.db.prepare('UPDATE fact_monthly_billing SET include_annual = ? WHERE id = ?')
            .bind(include ? 1 : 0, billingId).run();

        const bill = await this.db.prepare('SELECT student_id, period_month FROM fact_monthly_billing WHERE id = ?').bind(billingId).first<any>();
        if (bill) {
            await this.createBill({
                id: billingId,
                student_id: bill.student_id,
                period_month: bill.period_month
            });
        }
    }

    async getBillDetails(billingId: string) {
        const details = await this.db.prepare(`
            SELECT bi.*, fc.name as category_name, fc.is_refundable
            FROM fact_billing_items bi
            JOIN dim_fee_categories fc ON bi.category_id = fc.id
            WHERE bi.billing_id = ?
        `).bind(billingId).all<any>();
        return details.results || [];
    }

    async applyDiscount(billingId: string, discountAmount: number, note: string, discountPercent: number = 0) {
        const bill = await this.db.prepare('SELECT id, student_id, total_amount FROM fact_monthly_billing WHERE id = ?').bind(billingId).first<any>();
        if (!bill) throw new Error('Hóa đơn không tồn tại');

        // Persistent update to student record
        if (discountPercent >= 0) {
            await this.db.prepare('UPDATE students SET discount_percent = ? WHERE id = ?').bind(discountPercent, bill.student_id).run();
        }

        // Check if category DISCOUNT exists
        await this.db.prepare('INSERT OR IGNORE INTO dim_fee_categories (id, name, default_amount, group_id) VALUES ("DISCOUNT", "Chiết khấu học phí", 0, "SYSTEM")').bind().run();

        // Xóa chiết khấu cũ nếu có
        await this.db.prepare('DELETE FROM fact_billing_items WHERE billing_id = ? AND category_id = "DISCOUNT"').bind(billingId).run();

        if (discountAmount > 0) {
            // Thêm chiết khấu mới
            await this.db.prepare('INSERT INTO fact_billing_items (id, billing_id, category_id, amount, quantity, total, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(`${billingId}_DISCOUNT`, billingId, 'DISCOUNT', -discountAmount, 1, -discountAmount, note).run();
        }

        // Cập nhật lại tổng tiền (total_amount)
        const items = await this.db.prepare('SELECT SUM(total) as new_total FROM fact_billing_items WHERE billing_id = ?').bind(billingId).first<{new_total: number}>();
        const newTotal = items?.new_total || 0;

        await this.db.prepare('UPDATE fact_monthly_billing SET total_amount = ? WHERE id = ?').bind(newTotal, billingId).run();

        return { success: true, newTotal };
    }

    async recordPayment(data: { billing_id: string, amount: number, method: string, transaction_ref?: string, note?: string }) {
        const bill = await this.db.prepare('SELECT id FROM fact_monthly_billing WHERE id = ?').bind(data.billing_id).first();
        if (!bill) throw new Error('Hóa đơn không tồn tại');

        const paymentId = `PAY_${Date.now()}_${data.billing_id}`;
        const paymentStmt = this.db.prepare(
            'INSERT INTO fact_payments (id, billing_id, amount, method, transaction_ref, note) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(paymentId, data.billing_id, data.amount, data.method, data.transaction_ref || null, data.note || null);

        const updateBillStmt = this.db.prepare(
            `UPDATE fact_monthly_billing 
             SET payment_status = CASE 
                WHEN (SELECT COALESCE(SUM(amount), 0) + ? FROM fact_payments WHERE billing_id = ?) >= total_amount THEN 'PAID'
                ELSE 'PARTIAL'
             END
             WHERE id = ?`
        ).bind(data.amount, data.billing_id, data.billing_id);

        return await this.db.batch([paymentStmt, updateBillStmt]);
    }

    async toggleBillPaymentStatus(billingId: string, paymentDate?: string) {
        const bill = await this.db.prepare('SELECT payment_status FROM fact_monthly_billing WHERE id = ?').bind(billingId).first<any>();
        if (!bill) throw new Error('Bill not found');
        const nextStatus = bill.payment_status === 'PAID' ? 'UNPAID' : 'PAID';
        const finalDate = nextStatus === 'PAID' ? (paymentDate || new Date().toISOString().split('T')[0]) : null;
        return await this.db.prepare('UPDATE fact_monthly_billing SET payment_status = ?, payment_date = ? WHERE id = ?').bind(nextStatus, finalDate, billingId).run();
    }
}
