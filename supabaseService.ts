import { supabase } from './supabaseClient';

export interface Category {
  id: string;
  name: string;
  keywords: string[];
  type: 'income' | 'expense';
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  ignored: boolean;
}

export const categoriesService = {
  async getAll(userId: string) {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data || [];
  },

  async create(userId: string, name: string, type: 'income' | 'expense') {
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: userId, name, type, keywords: [] })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<Category>) {
    const { error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async addKeyword(id: string, keyword: string) {
    const { data: category } = await supabase
      .from('categories')
      .select('keywords')
      .eq('id', id)
      .single();

    if (!category) throw new Error('Category not found');

    const keywords = [...(category.keywords || []), keyword];

    const { error } = await supabase
      .from('categories')
      .update({ keywords })
      .eq('id', id);

    if (error) throw error;
  },

  async removeKeyword(id: string, keyword: string) {
    const { data: category } = await supabase
      .from('categories')
      .select('keywords')
      .eq('id', id)
      .single();

    if (!category) throw new Error('Category not found');

    const keywords = (category.keywords || []).filter((k: string) => k !== keyword);

    const { error } = await supabase
      .from('categories')
      .update({ keywords })
      .eq('id', id);

    if (error) throw error;
  }
};

export const transactionsService = {
  async getAll(userId: string) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) throw error;

    return (data || []).map(t => ({
      ...t,
      date: new Date(t.date).toLocaleDateString('es-ES'),
      amount: Number(t.amount)
    }));
  },

  async create(userId: string, transaction: Omit<Transaction, 'id'>) {
    const dateParts = transaction.date.split('/');
    const isoDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : transaction.date;

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        date: isoDate,
        description: transaction.description,
        amount: transaction.amount,
        category: transaction.category,
        ignored: transaction.ignored
      })
      .select()
      .single();

    if (error) throw error;
    return {
      ...data,
      date: new Date(data.date).toLocaleDateString('es-ES'),
      amount: Number(data.amount)
    };
  },

  async createBatch(userId: string, transactions: Omit<Transaction, 'id'>[]) {
    const transactionsToInsert = transactions.map(t => {
      const dateParts = t.date.split('/');
      const isoDate = dateParts.length === 3
        ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
        : t.date;

      return {
        user_id: userId,
        date: isoDate,
        description: t.description,
        amount: t.amount,
        category: t.category,
        ignored: t.ignored
      };
    });

    const { data, error } = await supabase
      .from('transactions')
      .insert(transactionsToInsert)
      .select();

    if (error) throw error;
    return (data || []).map(t => ({
      ...t,
      date: new Date(t.date).toLocaleDateString('es-ES'),
      amount: Number(t.amount)
    }));
  },

  async update(id: string, updates: Partial<Transaction>) {
    const updateData: any = { ...updates };

    if (updates.date) {
      const dateParts = updates.date.split('/');
      if (dateParts.length === 3) {
        updateData.date = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      }
    }

    const { error } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};

export const migrationService = {
  async importFromLocalStorage() {
    const savedData = localStorage.getItem('finanzasNudistaSession');
    if (!savedData) return null;

    try {
      const parsed = JSON.parse(savedData);
      return {
        transactions: parsed.transactions || [],
        categories: parsed.categories || { income: [], expense: [] },
        numberFormat: parsed.numberFormat || 'eur'
      };
    } catch (error) {
      console.error('Error parsing localStorage data:', error);
      return null;
    }
  },

  async migrateToSupabase(userId: string, localData: any) {
    const allCategories = [
      ...(localData.categories.income || []).map((c: any) => ({ ...c, type: 'income' as const })),
      ...(localData.categories.expense || []).map((c: any) => ({ ...c, type: 'expense' as const }))
    ];

    for (const cat of allCategories) {
      await supabase.from('categories').insert({
        user_id: userId,
        name: cat.name,
        type: cat.type,
        keywords: cat.keywords || []
      });
    }

    const transactions = localData.transactions || [];
    if (transactions.length > 0) {
      await transactionsService.createBatch(userId, transactions);
    }

    localStorage.removeItem('finanzasNudistaSession');
  }
};
