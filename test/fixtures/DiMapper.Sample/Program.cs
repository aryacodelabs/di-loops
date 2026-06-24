using DiMapper.Sample.Extensions;
using DiMapper.Sample.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<IAppHost, AppHost>();
builder.Services.AddScoped<IUserContext, UserContext>();
builder.Services.AddSingleton<Worker, Worker>();
builder.Services.AddTransient<ITransientService, TransientService>();
builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddSingleton<IOrderService, OrderService>();
builder.Services.AddSingleton<MultiCtorService, MultiCtorService>();
builder.Services.AddServiceRegistrations();

var app = builder.Build();
app.Run();